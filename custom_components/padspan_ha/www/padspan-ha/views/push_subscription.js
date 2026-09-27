// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A backend push subscription (padspan_ha/motion_reconnects) that survives a
// Home Assistant restart on a page that stays open, like a wall kiosk.
//
// The frontend keeps ONE Connection object across reconnects, so "subscribe
// again when hass.connection changes" never fires after a restart. The
// library's own automatic re-subscribe (resubscribe: true) reaches HA before
// PadSpan has registered its commands (HA serves the websocket from stage 0,
// custom integrations load in stage 2): HA answers unknown_command, the
// library drops the subscription, and nothing retries. So this subscribes
// with resubscribe: false, subscribes again on every "ready" (each
// reconnect), and retries a refused subscribe with a backoff until PadSpan
// has loaded.

const RETRY_MS = 5000, RETRY_MAX_MS = 60000;

/** Keep `msg` subscribed on `conn`, calling `onMessage` with each push.
 *  Returns stop(). */
export function keepSubscribed(conn, msg, onMessage) {
  let stopped = false, gen = 0, unsub = null, timer = null, delay = RETRY_MS;
  const drop = (u) => { try { Promise.resolve(u && u()).catch(() => {}); } catch (_) { /* socket gone */ } };
  const attempt = () => {
    if (stopped) return;
    clearTimeout(timer); timer = null;
    const my = ++gen;
    conn.subscribeMessage(onMessage, msg, { resubscribe: false }).then(
      (u) => {
        // A newer attempt (a reconnect) superseded this one: one live subscription only.
        if (stopped || my !== gen) { drop(u); return; }
        unsub = u; delay = RETRY_MS;
      },
      () => {
        if (stopped || my !== gen) return;
        timer = setTimeout(attempt, delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      });
  };
  // The old subscription died with the old socket: nothing to unsubscribe.
  const onReady = () => { unsub = null; delay = RETRY_MS; attempt(); };
  conn.addEventListener("ready", onReady);
  attempt();
  return () => {
    stopped = true; clearTimeout(timer);
    conn.removeEventListener("ready", onReady);
    drop(unsub); unsub = null;
  };
}
