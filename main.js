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
  NEW_PROJECT_SERVICE_KEY
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
  await runCommand(`supabase db dump --db-url "${OLD_DB_URL}" -f roles.sql --role-only`);
  await runCommand(`supabase db dump --db-url "${OLD_DB_URL}" -f schema.sql`);
  await runCommand(`supabase db dump --db-url "${OLD_DB_URL}" -f data.sql --use-copy --data-only`);
}

async function restoreDatabase() {
  console.log("Restoring to the new database...");
  await runCommand(`
    psql \\
      --single-transaction \\
      --variable ON_ERROR_STOP=1 \\
      --file roles.sql \\
      --file schema.sql \\
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

  for (const objectData of oldObjects) {
    console.log(`Moving ${objectData.id}`);
    try {
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

async function main() {
  try {
    await backupDatabase();
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