// The fixture origin for the Workers leg, run as a second Worker and wired up
// as the test Worker's `outboundService`. workerd has no `node:http`, so the
// trick the Node spec uses — start a server, hand netgrep its port — is not
// available; and netgrep calls the global `fetch` rather than accepting an
// injected one, so the fixture has to answer a real outbound request. Making
// every outbound fetch land here is the way to arrange that.
//
// Same body as `node.spec.ts` and `deno-smoke.ts`: big enough to arrive in
// several chunks, with matches at the very start and the very end.
const LINES = 200_000;
const out = [];

for (let i = 1; i <= LINES; i++) {
  out.push(
    i === 137
      ? `line ${i} ECONNREFUSED upstream`
      : `line ${i} ordinary padding text here`,
  );
}

out.push(`line ${LINES + 1} ECONNREFUSED again`);

const payload = `${out.join('\n')}\n`;

export default {
  fetch: () =>
    new Response(payload, { headers: { 'content-type': 'text/plain' } }),
};
