// A stdio MCP server with one tool and two skills (SEP-2640), for
// ahp-1-1-checks.mjs.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const skill = (name, body) => {
  const text = `---\nname: ${name}\ndescription: The ${name} skill of the check\n---\n\n${body}\n`;
  return {
    uri: `skill://${name}/SKILL.md`, text,
    frontmatter: { name, description: `The ${name} skill of the check` },
    resources: [{ uri: `skill://${name}/SKILL.md`, digest: `sha256:${createHash('sha256').update(text).digest('hex')}`, size: Buffer.byteLength(text) }],
  };
};
const skills = [skill('refunds', 'A refund always ends with the word PINEAPPLE.'), skill('triage', 'Triage sorts by date.')];
const answers = {
  initialize: (p) => ({
    protocolVersion: p.protocolVersion, serverInfo: { name: 'desk', version: '1' },
    capabilities: { tools: {}, resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } },
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools: [{ name: 'hours', description: 'The opening hours', inputSchema: { type: 'object', properties: {} } }] }),
  'tools/call': () => ({ content: [{ type: 'text', text: '9 to 5' }] }),
  'resources/list': () => ({ resources: [] }),
  'resources/templates/list': () => ({ resourceTemplates: [] }),
  'skills/list': () => ({ skills: skills.map(({ text, ...one }) => one) }),
  'resources/read': (p) => ({ contents: skills.filter((one) => one.uri === p.uri).map((one) => ({ uri: one.uri, text: one.text })) }),
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  const answer = answers[method];
  process.stdout.write(`${JSON.stringify(answer === undefined
    ? { jsonrpc: '2.0', id, error: { code: -32601, message: 'no such method' } }
    : { jsonrpc: '2.0', id, result: answer(params ?? {}) })}\n`);
});
