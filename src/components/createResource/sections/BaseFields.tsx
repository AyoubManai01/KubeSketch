import { isClusterScoped } from '../../../utils/k8sScope';
import NamespaceField from '../../NamespaceField';
import type { SupportedKind } from '../../../types/types';
import type { CreateFormBundle } from '../formTypes';

interface Props {
    kind: SupportedKind;
    form: CreateFormBundle;
    firstInputRef: React.RefObject<HTMLInputElement | null>;
}

/** Name + Namespace base fields shared by every kind. */
export function BaseFields({ kind, form, firstInputRef }: Props) {
    const { state, set, derived } = form;
    const { name, namespace } = state;
    const { setName, setNamespace, setNsCreateOpen } = set;
    const { suggestedName, namespaceOptions, nameError, namespaceError } = derived;

    return (
        <div className="modal-row">
            <div className="modal-field">
                <label className="modal-field__label">Name</label>
                <input
                    ref={firstInputRef}
                    className={`modal-field__input ${nameError ? 'modal-field__input--invalid' : ''}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={suggestedName}
                />
                {nameError && <span className="modal-field__error">{nameError}</span>}
            </div>
            {!isClusterScoped(kind) && (
                <div className="modal-field">
                    <label className="modal-field__label">Namespace</label>
                    <div className="namespace-field-group">
                        <NamespaceField
                            value={namespace}
                            onChange={setNamespace}
                            options={namespaceOptions}
                        />
                        <button
                            type="button"
                            className="namespace-field__new"
                            onClick={() => setNsCreateOpen(true)}
                            title="Create a new namespace rectangle"
                        >
                            + New
                        </button>
                    </div>
                    {namespaceError && (
                        <span className="modal-field__error">{namespaceError}</span>
                    )}
                </div>
            )}
        </div>
    );
}