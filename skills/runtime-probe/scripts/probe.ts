const token = process.argv[2];
if (typeof token !== 'string') {
  process.stderr.write('token is required\n');
  process.exit(2);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  marker: 'AGENT_TOOLBOX_SKILL_PROBE_OK',
  token,
})}\n`);
