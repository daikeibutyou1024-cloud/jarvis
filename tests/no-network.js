// All billable and research HTTP traffic in unit tests must be mocked explicitly.
globalThis.fetch=async()=>{throw Error('Real network is forbidden in offline tests');};
