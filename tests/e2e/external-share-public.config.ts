// [Input] Parent harness-owned loopback HTTP endpoint and named disposable database identity.
// [Output] Bounded API-only Playwright checks against the original Next public route.
// [Pos] External-share isolated HTTP configuration; no browser, model or normal service.
import {defineConfig} from '@playwright/test';
const baseURL = process.env.EXTERNAL_SHARE_TEST_URL;
const target = baseURL ? new URL(baseURL) : null;
if (process.env.EXTERNAL_SHARE_TEST_OWNED !== '1' || !/^ink_external_share_test_[a-f0-9]+$/.test(process.env.EXTERNAL_SHARE_TEST_DB ?? '') || target?.hostname !== '127.0.0.1' || !target.port) throw Error('OWNED_SHARE_HTTP_TARGET_REQUIRED');
export default defineConfig({testDir: '.', testMatch: 'external-share-public.spec.ts', workers: 1, timeout: 30_000, outputDir: '../../test-results/external-share-public', use: {baseURL}});
