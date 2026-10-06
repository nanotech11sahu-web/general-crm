import * as init from './20250101000001-init';
import * as indexesV2 from './20250601000001-indexes-v2';
import * as billing from './20250701000001-billing';
import * as email from './20250801000001-email';
import * as aiExtras from './20250901000001-ai-extras';
import * as invoices from './20251001000001-invoices';

export const MIGRATIONS = [init, indexesV2, billing, email, aiExtras, invoices];
