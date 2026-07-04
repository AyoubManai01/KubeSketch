import yaml from 'js-yaml';
import type { K8sResource } from '../types/types';

export function resourcesToYaml(resources: K8sResource[]): string {
    if (resources.length === 0) return '';
    return resources
        .map((resource) =>
            yaml
                .dump(resource, { noRefs: true, skipInvalid: true, lineWidth: 120 })
                .trim()
        )
        .join('\n---\n');
}
