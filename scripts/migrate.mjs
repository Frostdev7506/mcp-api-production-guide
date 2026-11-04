import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
if(!process.env.MIGRATION_DATABASE_URL)throw new Error('Set MIGRATION_DATABASE_URL from the deployment secret store; runtime credentials must not have DDL privileges.');
const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1,connectionTimeoutMillis:3000});
let client;
try {
 client=await pool.connect();await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(1856885420)');
 await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
 let applied=0;
 for(const version of (await readdir('migrations')).filter(f=>/^\d{3}-[a-z0-9-]+\.sql$/.test(f)).sort()){
  const sql=await readFile(resolve('migrations',version),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
  const existing=await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[version]);
  if(existing.rowCount){if(existing.rows[0].checksum!==checksum)throw new Error('Applied migration was edited: '+version);continue;}
  await client.query(sql);await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[version,checksum]);applied++;
 }
 await client.query('COMMIT');console.log(JSON.stringify({event:'migrations_complete',applied}));
} catch(error){if(client)await client.query('ROLLBACK');throw error;}
finally{client?.release();await pool.end();}
