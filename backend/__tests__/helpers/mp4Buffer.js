const box = (type, ...payload) => {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
};

const mvhdPayload = (seconds, version, timescale = 1000) => {
  const payload = Buffer.alloc(version === 1 ? 32 : 20);
  payload[0] = version;
  if (version === 1) {
    payload.writeUInt32BE(timescale, 20);
    payload.writeBigUInt64BE(BigInt(seconds * timescale), 24);
  } else {
    payload.writeUInt32BE(timescale, 12);
    payload.writeUInt32BE(seconds * timescale, 16);
  }
  return payload;
};

/** The smallest MP4 structure the server reads: ftyp, then media data, then moov > mvhd. */
export const mp4Buffer = ({ seconds, version = 0, brand = "isom", padBytes = 16 }) =>
  Buffer.concat([
    box("ftyp", Buffer.from(`${brand}\0\0\x02\0`, "latin1")),
    box("mdat", Buffer.alloc(padBytes)),
    box("moov", box("mvhd", mvhdPayload(seconds, version))),
  ]);
