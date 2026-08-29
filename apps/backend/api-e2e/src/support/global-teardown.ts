import { killPort } from '@nx/node/utils';

// Shared with global-setup, which declares it on `globalThis`.
declare const __TEARDOWN_MESSAGE__: string;
 

module.exports = async function () {
  // Put clean up logic here (e.g. stopping services, docker-compose, etc.).
  // Hint: `globalThis` is shared between setup and teardown.
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await killPort(port);
  console.log(__TEARDOWN_MESSAGE__);
};
