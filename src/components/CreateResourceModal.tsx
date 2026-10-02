import { useVeltraStore } from '../store/store';
import NamespaceModal from './NamespaceModal';
import { hexToRgba } from './kindMeta';
import { useCreateResourceForm } from './createResource/useCreateResourceForm';
import { buildCreatedResource, buildCreatedResourceLink } from './createResource/buildCreatedResource';
import { BaseFields } from './createResource/sections/BaseFields';
import { AppLabelSection } from './createResource/sections/AppLabelSection';
import { WorkloadSections } from './createResource/sections/WorkloadSections';
import { NetworkSections } from './createResource/sections/NetworkSections';
import { ConfigSections } from './createResource/sections/ConfigSections';
import { StorageSections } from './createResource/sections/StorageSections';
import { GatewaySections } from './createResource/sections/GatewaySections';
import type { SupportedKind } from '../types/types';

interface Props {
    kind: SupportedKind;
    onClose: () => void;
}

export default function CreateResourceModal({ kind, onClose }: Props) {
    const addConfiguredNode = useVeltraStore((s) => s.addConfiguredNode);
    const form = useCreateResourceForm(kind, onClose);
    const { state, derived } = form;

    function handleCreate() {
        if (derived.nameError) return;
        if (derived.namespaceError) return;
        if (state.cmTarget && state.cmMechanism === 'envKey' && !state.cmKey) return;
        if (state.secretTarget && state.secretMechanism === 'envKey' && !state.secretKey) return;
        if (state.pvcMountTarget && (!state.pvcVolumeName.trim() || !!derived.pvcMountReplicasError)) return;
        const resource = buildCreatedResource(kind, form);
        const link = buildCreatedResourceLink(kind, form);
        if (link) {
            addConfiguredNode(kind, resource, link);
        } else {
            addConfiguredNode(kind, resource);
        }
        onClose();
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="modal-header">
                    <div
                        className="modal-header__icon"
                        style={{
                            backgroundColor: hexToRgba(derived.color, 0.13),
                            border: `1px solid ${hexToRgba(derived.color, 0.28)}`,
                            color: derived.color,
                        }}
                    >
                        {derived.icon}
                    </div>
                    <span className="modal-header__title">Create {kind}</span>
                    <button type="button" className="modal-header__close" onClick={onClose} title="Close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="modal-body">
                    {/* Base fields */}
                    <BaseFields kind={kind} form={form} firstInputRef={form.firstInputRef} />

                    {/* App Label: auto-generated for workloads/Pods, target picker for Services */}
                    <AppLabelSection kind={kind} form={form} />

                    {/* Workload: replicas + Pod container + Job + CronJob */}
                    <WorkloadSections kind={kind} form={form} />

                    {/* Service + Ingress + HPA + VPA */}
                    <NetworkSections kind={kind} form={form} />

                    {/* ConfigMap + Secret */}
                    <ConfigSections kind={kind} form={form} />

                    {/* PVC + PV + StorageClass */}
                    <StorageSections kind={kind} form={form} />

                    {/* GatewayClass + Gateway + Routes */}
                    <GatewaySections kind={kind} form={form} />
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    <button type="button" className="modal-btn modal-btn--secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': derived.color } as React.CSSProperties}
                        onClick={handleCreate}
                        disabled={
                            !!derived.nameError ||
                            !!derived.namespaceError ||
                            !!derived.scheduleError ||
                            (kind === 'ConfigMap' && !!state.cmTarget && state.cmMechanism === 'envKey' && !state.cmKey) ||
                            (kind === 'Secret' && !!state.secretTarget && state.secretMechanism === 'envKey' && !state.secretKey) ||
                            (kind === 'PersistentVolumeClaim' && !!state.pvcMountTarget && (!state.pvcVolumeName.trim() || !!derived.pvcMountReplicasError))
                        }
                        title={
                            derived.nameError ||
                            derived.namespaceError ||
                            derived.scheduleError ||
                            (kind === 'ConfigMap' && state.cmTarget && state.cmMechanism === 'envKey' && !state.cmKey
                                ? 'Select a data key first'
                                : kind === 'Secret' && state.secretTarget && state.secretMechanism === 'envKey' && !state.secretKey
                                ? 'Select a data key first'
                                : kind === 'PersistentVolumeClaim' && state.pvcMountTarget && !state.pvcVolumeName.trim()
                                ? 'Volume name is required to mount the claim'
                                : kind === 'PersistentVolumeClaim' && derived.pvcMountReplicasError
                                ? derived.pvcMountReplicasError
                                : `Create ${kind}`)
                        }
                    >
                        Create {kind}
                    </button>
                </div>
            </div>

            {/* Stacked namespace creation prompt: renders above the create
                modal (later in DOM, same overlay z-index) and auto-selects the
                new namespace on success. */}
            {state.nsCreateOpen && (
                <NamespaceModal
                    onClose={() => form.set.setNsCreateOpen(false)}
                    onCreated={(created) => form.set.setNamespace(created)}
                />
            )}
        </div>
    );
}