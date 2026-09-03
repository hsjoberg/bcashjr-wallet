export function transactionPage(apiUrl: string, txid: string): string {
  const url = new URL(apiUrl);
  const explorerPath = url.pathname.replace(/\/+$/u, "").replace(/\/api$/u, "");
  url.pathname = `${explorerPath}/tx/${txid}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
