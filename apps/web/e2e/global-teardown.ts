export default async function teardown() {
  const pid = Number(process.env.E2E_TEARDOWN_PID);
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
}
