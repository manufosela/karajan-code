// KJC-TSK-1576 (ADR 0056, point 3): the board's WebRTC is node-datachannel in the shape the mesh
// expects. Two real peers in this process swap their descriptions and candidates by hand and open
// a channel; no room, no network beyond this machine.
import { describe, expect, it } from 'vitest';

import { nodeRtc } from '../src/room/rtc-node.js';

describe('nodeRtc', () => {
  it('opens a data channel between two peers and carries a message', async () => {
    const heard = [];
    let answerer;
    let offerer;
    const channelOpen = new Promise((resolve) => {
      answerer = nodeRtc.connect({
        onDescription: (sdp, type) => offerer.setRemote(sdp, type),
        onCandidate: (candidate, mid) => offerer.addCandidate(candidate, mid),
        onChannel: (channel) => { channel.onMessage((text) => heard.push(text)); resolve(); },
      });
    });
    offerer = nodeRtc.connect({
      onDescription: (sdp, type) => answerer.setRemote(sdp, type),
      onCandidate: (candidate, mid) => answerer.addCandidate(candidate, mid),
      onChannel: () => {},
    });
    const channel = offerer.openChannel('activity');
    await channelOpen;
    for (let i = 0; i < 100 && !channel.isOpen(); i++) await new Promise((r) => setTimeout(r, 50));
    channel.send('{"role":"coder"}');
    for (let i = 0; i < 100 && !heard.length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(heard).toEqual(['{"role":"coder"}']);
    offerer.close();
    answerer.close();
  }, 15000);
});
