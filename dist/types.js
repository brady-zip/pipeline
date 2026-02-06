export function makeJobKey(workflow, jobId) {
    return `${workflow}:${jobId}`;
}
export function parseJobKey(key) {
    const idx = key.indexOf(":");
    if (idx === -1)
        throw new Error(`Invalid job key: ${key}`);
    return { workflow: key.slice(0, idx), jobId: key.slice(idx + 1) };
}
