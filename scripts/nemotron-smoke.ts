import { complete, credentialsConfigured, modelId, type Message, type Tool } from '../server/nvidia';

async function main() {
  if (!credentialsConfigured) {
    console.log('SKIPPED / MISSING KEY — NVIDIA smoke test');
    return;
  }
  const plain = await complete([{ role: 'user', content: 'Reply with only the word READY.' }]);
  if (plain.content?.trim().replace(/[.!]$/, '').toUpperCase() !== 'READY') throw new Error('Plain completion did not return READY.');
  console.log('PASS plain completion — ' + plain.model);
  const tool: Tool = { type: 'function', function: {
    name: 'read_demo_measurement', description: 'Returns the hidden verification value for this test.',
    parameters: { type: 'object', properties: { sample: { type: 'string', enum: ['demo'] } }, required: ['sample'], additionalProperties: false },
  } };
  const messages: Message[] = [{ role: 'user', content: 'Call read_demo_measurement with sample demo. Then reply with only the exact verification value from the tool.' }];
  const first = await complete(messages, [tool]);
  const call = first.calls[0];
  if (first.calls.length !== 1 || call.function.name !== tool.function.name || JSON.parse(call.function.arguments).sample !== 'demo') {
    throw new Error('Expected a real structured read_demo_measurement call.');
  }
  const verification = 'EMBER-' + Math.floor(100000 + Math.random() * 900000);
  messages.push({ role: 'assistant', content: first.content, tool_calls: first.calls },
    { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ verification }) });
  const finish = await complete(messages, [tool]);
  if (finish.calls.length || !finish.content?.includes(verification)) throw new Error('Final completion did not use the tool result.');
  console.log('PASS authenticated tool roundtrip — ' + finish.model + ' → ' + call.function.name + ' → verified value');
}

main().catch((error: unknown) => {
  console.error('FAIL NVIDIA smoke test (' + modelId + ') — ' + (error instanceof Error ? error.message : 'Unknown failure'));
  process.exitCode = 1;
});
