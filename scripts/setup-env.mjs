import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const password=()=>randomBytes(32).toString('hex');
const app=password();
const values={POSTGRES_PASSWORD:password(),SUPPORT_DB_PASSWORD:app,KEYCLOAK_DB_PASSWORD:password(),KEYCLOAK_ADMIN_PASSWORD:password(),DELEGATION_SECRET:password(),DATABASE_URL:`postgresql://support_app:${app}@127.0.0.1:5547/support`,API_URL:'http://127.0.0.1:4310',MCP_URL:'http://127.0.0.1:4311/mcp',OAUTH_ISSUER:'http://127.0.0.1:8187/realms/support-demo',APP_MODE:'local'};
try {await writeFile('.env',Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});console.log('Created private local .env. Credentials are not printed.');}
catch(e){if(e.code==='EEXIST')console.log('Preserved existing .env.');else throw e;}
