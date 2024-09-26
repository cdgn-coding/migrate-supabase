const { exec } = require('child_process');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const credentials = require('./credentials');

const {
  OLD_DB_URL,
  NEW_DB_URL,
  OLD_PROJECT_URL,
  OLD_PROJECT_SERVICE_KEY,
  NEW_PROJECT_URL,
  NEW_PROJECT_SERVICE_KEY,
  OLD_PERSONAL_ACCESS_TOKEN,
} = credentials;

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
      }
      console.log(`stdout: ${stdout}`);
      resolve(stdout);
    });
  });
}

async function backupDatabase() {
  console.log("Backing up the old database...");
  // await runCommand(`supabase db dump --db-url "${OLD_DB_URL}" -f roles.sql --role-only`);
  // await runCommand(`supabase db dump --db-url "${OLD_DB_URL}" --schema public,webhook -f schema.sql`);
  await runCommand(`supabase db dump --db-url "${OLD_DB_URL}" -f data.sql --schema public,auth --use-copy --data-only`);
}

async function restoreDatabase() {
  console.log("Restoring to the new database...");
  // --file roles.sql \\
  // --file schema.sql \\
  await runCommand(`
    psql \\
      --single-transaction \\
      --variable ON_ERROR_STOP=1 \\
      --command 'SET session_replication_role = replica' \\
      --file data.sql \\
      --dbname "${NEW_DB_URL}"
  `);
}

async function preserveMigrationHistory() {
  console.log("Preserving migration history...");
  await runCommand(`supabase db dump --db-url "${OLD_DB_URL}" -f history_schema.sql --schema supabase_migrations`);
  await runCommand(`supabase db dump --db-url "${OLD_DB_URL}" -f history_data.sql --use-copy --data-only --schema supabase_migrations`);
  await runCommand(`
    psql \\
      --single-transaction \\
      --variable ON_ERROR_STOP=1 \\
      --file history_schema.sql \\
      --file history_data.sql \\
      --dbname "${NEW_DB_URL}"
  `);
}

async function migrateStorageObjects() {
  console.log("Migrating storage objects...");
  const oldSupabaseRestClient = createClient(OLD_PROJECT_URL, OLD_PROJECT_SERVICE_KEY, {
    db: { schema: 'storage' },
  });
  const oldSupabaseClient = createClient(OLD_PROJECT_URL, OLD_PROJECT_SERVICE_KEY);
  const newSupabaseClient = createClient(NEW_PROJECT_URL, NEW_PROJECT_SERVICE_KEY);

  const { data: oldObjects, error } = await oldSupabaseRestClient.from('objects').select();
  if (error) {
    console.log('Error getting objects from old bucket');
    throw error;
  }

  const processedBuckets = new Set();

  for (const objectData of oldObjects) {
    console.log(`Moving ${objectData.id}`);
    try {
      // Check if the bucket exists in the new project, create if it doesn't
      if (!processedBuckets.has(objectData.bucket_id)) {
        await createBucketIfNotExists(newSupabaseClient, objectData.bucket_id);
        processedBuckets.add(objectData.bucket_id);
      }

      const { data, error: downloadObjectError } = await oldSupabaseClient.storage
        .from(objectData.bucket_id)
        .download(objectData.name);
      if (downloadObjectError) throw downloadObjectError;
      
      const { _, error: uploadObjectError } = await newSupabaseClient.storage
        .from(objectData.bucket_id)
        .upload(objectData.name, data, {
          upsert: true,
          contentType: objectData.metadata.mimetype,
          cacheControl: objectData.metadata.cacheControl,
        });
      if (uploadObjectError) throw uploadObjectError;
    } catch (err) {
      console.log('Error moving ', objectData);
      console.log(err);
    }
  }
}

async function createBucketIfNotExists(supabaseClient, bucketName) {
  try {
    const { data, error } = await supabaseClient.storage.getBucket(bucketName);
    if (error) {
      if (error.statusCode === 404) {
        console.log(`Bucket ${bucketName} not found. Creating...`);
        const { data, error: createError } = await supabaseClient.storage.createBucket(bucketName, {
          public: false, // Adjust this based on your requirements
        });
        if (createError) throw createError;
        console.log(`Bucket ${bucketName} created successfully.`);
      } else {
        throw error;
      }
    } else {
      console.log(`Bucket ${bucketName} already exists.`);
    }
  } catch (err) {
    console.log(`Error checking/creating bucket ${bucketName}:`, err);
    throw err;
  }
}

async function migratePgsodiumKey() {
  console.log("Migrating pgsodium key...");
  try {
    // Extract project references from the project URLs
    const oldProjectRef = OLD_PROJECT_URL.split('.')[0].split('://')[1];

    // Fetch the pgsodium key from the old project
    const oldResponse = await fetch(`https://api.supabase.com/v1/projects/${oldProjectRef}/pgsodium`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${OLD_PERSONAL_ACCESS_TOKEN}`
      }
    });

    if (!oldResponse.ok) {
      throw new Error(`HTTP error! status: ${oldResponse.status}`);
    }

    const pgsodiumData = await oldResponse.json();
    const rootKey = pgsodiumData.root_key;
    console.log('Old pgsodium key recovered');

    console.log('Setting up pgsodium key in the new project...');
    // Construct the SQL query
    const sqlQuery = `
      SELECT set_config('pgsodium.default_key', '${rootKey}', false);
      SELECT pgsodium.create_key(1, '${rootKey}');
    `;

    // Write the SQL query to a temporary file
    fs.writeFileSync('temp_pgsodium_query.sql', sqlQuery);

    // Execute the SQL query using psql
    await runCommand(`
      psql "${NEW_DB_URL}" -f temp_pgsodium_query.sql
    `);

    // Remove the temporary file
    fs.unlinkSync('temp_pgsodium_query.sql');

    console.log("pgsodium key migration completed successfully");
  } catch (error) {
    console.error("Error migrating pgsodium key:", error.message);
    throw error;
  }
}

async function main() {
  try {
    await backupDatabase();
    await migratePgsodiumKey();
    await restoreDatabase();
    await preserveMigrationHistory();
    await migrateStorageObjects();
        
    console.log("Migration completed successfully!");
    console.log("Please remember to:");
    console.log("1. Enable necessary extensions in your self-hosted Supabase");
    console.log("2. Set up column encryption key if you use it");
    console.log("3. Set passwords for any custom roles with login attributes");
    console.log("4. Enable publication on tables for Realtime functionality");
    console.log("5. Verify and reconfigure webhooks and triggers");
    console.log("6. Test thoroughly to ensure all data and functionality has been correctly migrated");
  } catch (error) {
    console.error("An error occurred during migration:", error);
  }
}

main();