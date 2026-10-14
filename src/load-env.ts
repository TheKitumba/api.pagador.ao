import { existsSync } from 'node:fs';

// Loaded before any other module so configuration is available at import time.
if (existsSync('.env')) process.loadEnvFile('.env');
