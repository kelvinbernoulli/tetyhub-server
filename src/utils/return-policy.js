const reasonTypePatterns = [
    [
        /\b(?:wrong|incorrect|different)\s+(?:product|item)\b|\bnot what (?:i|we) ordered\b/,
        'wrong_item',
    ],
    [/\b(?:defective|damaged|broken|unsafe)\b/, 'defective_or_unsafe'],
    [/\b(?:misdescribed|not as described)\b/, 'misdescribed'],
    [/\bunsuitable for (?:the )?stated purpose\b/, 'unsuitable_for_stated_purpose'],
    [
        /\b(?:vendor|merchant|seller) (?:fault|error)\b|\bfulfil?ment error\b/,
        'vendor_fault',
    ],
    [/\b(?:change of mind|changed my mind)\b/, 'change_of_mind'],
];

export function resolveReturnReasonType(reason, requestedReasonType) {
    const normalizedReason = String(reason ?? '').trim().toLowerCase();
    return (
        reasonTypePatterns.find(([pattern]) => pattern.test(normalizedReason))?.[1] ??
        requestedReasonType
    );
}

export function requiresReturnEvidence(reasonType) {
    return reasonType !== 'change_of_mind';
}

export function normalizeReturnRequest(input) {
    return {
        ...input,
        reason_type: resolveReturnReasonType(input?.reason, input?.reason_type),
    };
}
