/* 시험용 가짜 fetch — 주소와 요청을 적어 두고 정해 둔 응답을 돌려준다.
 * reply: 응답 하나({ status, json, text }), 던질 오류, 또는 (url, init) => 응답. */
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const value = typeof reply === "function" ? reply(url, init) : reply;
    if (value instanceof Error) throw value;
    const { status = 200, json = {}, text } = value;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => (text !== undefined ? text : JSON.stringify(json)),
    };
  };
  impl.calls = calls;
  return impl;
}

module.exports = { fakeFetch };
