/** A1 接入各厂商网络层前，Adapter.chat 统一返回此错误文案。 */
export class ProviderNotReadyError extends Error {
  constructor(
    providerLabel: string,
    message = `${providerLabel} Provider 网络层尚未接入（计划于 A1 完成）。`,
  ) {
    super(message);
    this.name = "ProviderNotReadyError";
  }
}
