/**
 * KJC-TSK-1571 (ADR 0056, point 3): the board's WebRTC, a thin layer over node-datachannel
 * (libdatachannel) in the shape mesh.js expects. A public STUN server finds the way through a NAT;
 * there is no TURN server, so a board that cannot open a channel falls back to the room's relay
 * (KJC-TSK-1568).
 */
import nodeDataChannel from 'node-datachannel';

const ICE = ['stun:stun.l.google.com:19302'];
let count = 0;

/** A data channel as mesh.js uses it. */
const channelOf = (dc) => ({
  isOpen: () => dc.isOpen(),
  send: (text) => dc.sendMessage(text),
  onMessage: (fn) => dc.onMessage((message) => fn(String(message))),
});

export const nodeRtc = {
  connect({ onDescription, onCandidate, onChannel }) {
    count += 1;
    const pc = new nodeDataChannel.PeerConnection(`kj-room-${count}`, { iceServers: ICE });
    pc.onLocalDescription((sdp, type) => onDescription(sdp, type));
    pc.onLocalCandidate((candidate, mid) => onCandidate(candidate, mid));
    pc.onDataChannel((dc) => onChannel(channelOf(dc)));
    return {
      openChannel: (label) => channelOf(pc.createDataChannel(label)),
      setRemote: (sdp, type) => pc.setRemoteDescription(sdp, type),
      addCandidate: (candidate, mid) => pc.addRemoteCandidate(candidate, mid),
      close: () => pc.close(),
    };
  },
};
