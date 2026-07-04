import yaml from 'js-yaml';
import type { K8sResource } from '../types/types';
import { SUPPORTED_KINDS } from '../types/types';

/**
 * Parse a multi-document YAML string and extract supported K8s resources.
 *
 * - Uses js-yaml `loadAll` to handle `---` document separators
 * - Filters to only Deployment, Service, and Ingress kinds
 * - Silently skips invalid or unsupported documents
 */
export function parseYaml(input: string): K8sResource[] {
    if (!input.trim()) return [];

    const docs: unknown[] = [];
    yaml.loadAll(input, (doc) => {
        if (doc) docs.push(doc);
    });

    return docs.filter(isK8sResource);
}

/**
 * Type-guard: checks that a parsed YAML document looks like a supported K8s resource.
 */
function isK8sResource(doc: unknown): doc is K8sResource {
    if (typeof doc !== 'object' || doc === null) return false;

    const obj = doc as Record<string, unknown>;

    return (
        typeof obj.kind === 'string' &&
        SUPPORTED_KINDS.includes(obj.kind as K8sResource['kind']) &&
        typeof obj.metadata === 'object' &&
        obj.metadata !== null &&
        typeof (obj.metadata as Record<string, unknown>).name === 'string'
    );
}
