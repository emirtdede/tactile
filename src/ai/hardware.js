// Hardware profiling for the optional local AI assistant.
//
// Everything runs from values the main process already has (os.cpus() and
// os.totalmem()), so the recommendation is available before any model is
// downloaded. The tiers are deliberately conservative: a model only gets
// recommended when the machine can keep it resident next to the user's normal
// workload.
const TIERS = ['low', 'medium', 'high', 'ultra'];

/**
 * Returns a plain object describing the machine and the largest model tier it
 * should be offered. Accepts injected values so tests never touch the host.
 */
function profileHardware({ cpus = [], totalmem = 0 } = {}) {
    const cores = Array.isArray(cpus) ? cpus.length : 0;
    const cpu = (Array.isArray(cpus) && cpus[0] && cpus[0].model ? String(cpus[0].model) : '').replace(/\s+/g, ' ').trim();
    const memoryGB = Math.max(1, Math.round((Number(totalmem) || 0) / (1024 ** 3)));

    let tier = 'low';
    if (memoryGB >= 32 && cores >= 8) tier = 'ultra';
    else if (memoryGB >= 16 && cores >= 6) tier = 'high';
    else if (memoryGB >= 8 && cores >= 4) tier = 'medium';

    return { cpu, cores, memoryGB, tier, tierIndex: TIERS.indexOf(tier) };
}

/** True when the machine can host `model` (catalog entry with minMemoryGB). */
function canRunModel(hardware, model) {
    if (!hardware || !model) return false;
    const requiredMemory = Number(model.minMemoryGB) || 0;
    const requiredTier = TIERS.indexOf(model.minTier || 'low');
    if ((Number(hardware.memoryGB) || 0) < requiredMemory) return false;
    return (Number(hardware.tierIndex) || 0) >= Math.max(0, requiredTier);
}

module.exports = { profileHardware, canRunModel, TIERS };
