# Supabase Migration Tool

This tool helps you migrate your Supabase project from a hosted instance to a self-hosted one.

## Prerequisites

- Node.js (v20.6 or later)
- npm
- Supabase CLI
- PostgreSQL client (psql)
- Docker (for running self-hosted Supabase)

## Setup

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/migrate-supabase.git
   cd migrate-supabase
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Rename `.env.example` to `.env`:
   ```
   mv .env.example .env
   ```

4. Open the `.env` file and fill in the correct values for your old (hosted) and new (self-hosted) Supabase instances:
   ```
   OLD_DB_URL=your_hosted_supabase_db_url
   NEW_DB_URL=your_self_hosted_supabase_db_url
   OLD_PROJECT_URL=https://your-old-project.supabase.co
   OLD_PROJECT_SERVICE_KEY=your-old-project-service-key
   NEW_PROJECT_URL=http://your-self-hosted-supabase-url
   NEW_PROJECT_SERVICE_KEY=your-self-hosted-service-key
   ```

## Usage

To run the migration:

```
npm run migrate
```

This script will:
1. Backup your old database
2. Restore the database to your self-hosted instance
3. Preserve migration history
4. Migrate storage objects

## Post-Migration Steps

After running the script, you'll need to manually:

1. Enable necessary extensions in your self-hosted Supabase
2. Set up column encryption key if you use it
3. Set passwords for any custom roles with login attributes
4. Enable publication on tables for Realtime functionality
5. Verify and reconfigure webhooks and triggers

## Security Note

The `.env` file contains sensitive information. Make sure to:
- Never commit this file to version control
- Restrict access to this file
- Delete or secure this file after the migration is complete

## Troubleshooting

If you encounter any issues during the migration, check the console output for error messages. Ensure that all prerequisites are correctly installed and that your Supabase instances are accessible.

## Contributing

If you'd like to contribute to this project, please fork the repository and submit a pull request.

## License

This project is licensed under the ISC License.
```

Now, create a `.env.example` file in your project root with the following content:

```
OLD_DB_URL=your_hosted_supabase_db_url
NEW_DB_URL=your_self_hosted_supabase_db_url
OLD_PROJECT_URL=https://your-old-project.supabase.co
OLD_PROJECT_SERVICE_KEY=your-old-project-service-key
NEW_PROJECT_URL=http://your-self-hosted-supabase-url
NEW_PROJECT_SERVICE_KEY=your-self-hosted-service-key
```

This setup provides a clear guide for users to set up and use your migration tool, emphasizing the importance of properly configuring the `.env` file with the correct Supabase credentials for both the old and new instances.