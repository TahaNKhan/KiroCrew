// Two disjoint counters so permission-request ids never collide with the
// in-flight session/prompt id. Pre-increment guards against accidental reuse;
// the disjoint starting ranges guarantee no overlap even with aggressive use.
export class IdAllocator {
  private outReq = 0;
  private permReq = 999_999;
  nextOutbound(): number {
    return ++this.outReq;
  }
  nextPermission(): number {
    return ++this.permReq;
  }
}
