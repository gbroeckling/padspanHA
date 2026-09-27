// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// hass.connection across a Home Assistant restart, with the behaviour of
// home-assistant-js-websocket 9.7.0 (dist/connection.js) that matters to a
// push subscription:
//
//   - ONE Connection object for the page's life; a restart closes the socket
//     and the library reconnects on the same object (_handleClose/_setSocket).
//   - On reconnect, every subscription made with resubscribe !== false is sent
//     again (`info.subscribe().then(...)`, no catch); resubscribe: false ones
//     are dropped. Then "ready" fires.
//   - A subscribe HA answers with success:false rejects and is forgotten
//     (the "result" handler: info.reject + commands.delete). Nothing retries.
//   - HA serves the websocket before custom integrations load, so a subscribe
//     that lands early is answered unknown_command. `padspanLoaded` is that.

export function fakeConnection() {
  const listeners = { ready: [] };
  let subs = [];                       // live on the current socket
  let nextId = 1;
  const conn = {
    padspanLoaded: true,
    wire: [],                          // every subscribe sent, with its answer
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    listenerCount(t) { return (listeners[t] || []).length; },
    get live() { return subs.length; },
    subscribeMessage(callback, message, options) {
      const id = nextId++;
      const ok = conn.padspanLoaded;
      conn.wire.push(`#${id} ${message.type} ${ok ? "ok" : "unknown_command"}`);
      return Promise.resolve().then(() => {
        if (!ok) throw { code: "unknown_command", message: "Unknown command." };
        const sub = { id, callback, message, options };
        subs.push(sub);
        return async () => { subs = subs.filter(s => s !== sub); };
      });
    },
    /** A push from the backend to every live subscription of `type`. */
    push(type, payload) { for (const s of subs) if (s.message.type === type) s.callback(payload); },
    /** HA restarts: the socket drops, the library reconnects (PadSpan loaded
     *  or not, per padspanLoaded at that moment), resubscribes, fires ready. */
    async restart() {
      const old = subs; subs = [];
      for (const s of old) {
        if (s.options && s.options.resubscribe === false) continue;
        // The library's own re-subscribe: a refusal is simply lost.
        conn.subscribeMessage(s.callback, s.message, s.options).catch(() => {});
      }
      await Promise.resolve();
      for (const f of [...(listeners.ready || [])]) f(conn);
      await Promise.resolve();
    },
  };
  return conn;
}
