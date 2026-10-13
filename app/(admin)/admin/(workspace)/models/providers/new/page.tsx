// [Input] Protected Provider route identity.
// [Output] Shared Provider form in the appropriate model-center context.
// [Pos] Navigation boundary; writes use existing authorized Admin APIs.
// [Sync] 2026-10-10: reuse Provider forms without mixing AI and Image navigation.

import ProviderFormPage from "@/components/admin/ProviderFormPage";
export default function NewProviderPage() { return <ProviderFormPage mode="create" />; }
