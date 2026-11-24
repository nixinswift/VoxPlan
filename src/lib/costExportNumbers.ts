/** Keep cents in client bids; never round exports to whole dollars. */
export const costExportNumber = (value: number) => Number(value.toFixed(2));