/** Client-side contact form payload for the landing page. */
export interface ContactFormState {
    name: string;
    email: string;
    org: string;
    message: string;
}

/** Build the mailto URL for the contact form (no backend; opens the mail app). */
export function buildContactMailto(form: ContactFormState): string {
    const subject = encodeURIComponent(
        form.org
            ? `KubeSketch cluster integration inquiry (${form.org})`
            : 'KubeSketch cluster integration inquiry'
    );
    const body = encodeURIComponent(
        `Name: ${form.name}\nEmail: ${form.email}\nOrganization: ${form.org || '-'}\n\n${form.message}`
    );
    return `mailto:?subject=${subject}&body=${body}`;
}