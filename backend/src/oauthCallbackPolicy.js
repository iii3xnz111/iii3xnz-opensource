export function callbackProviderFromState(stateRow) {
  if (!stateRow || typeof stateRow.provider !== "string" || !stateRow.provider) {
    throw new Error("OAuth state has no provider");
  }
  return stateRow.provider;
}
