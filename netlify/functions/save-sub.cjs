// Minimal placeholder: ingen lagring – bare 201 OK så UI-flyten din funker.
module.exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { 'content-type': 'text/plain' }, body: 'Method Not Allowed' };
    }
    return { statusCode: 201, headers: { 'content-type': 'text/plain' }, body: 'OK (no storage)' };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'text/plain' }, body: 'save-sub crashed: ' + (e?.message || String(e)) };
  }
};
