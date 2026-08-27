import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listProducts } from "@/lib/products/actions";
import { ProductsManager } from "@/components/products-manager";
import { getServerMessages } from "@/lib/i18n/server";

// The Products library — the "A" of "B on A" (2026-08-27): a product is
// uploaded once (photos + optional logo) and every Studio shoot picks from
// this shelf. The page is just the shelf; all logic lives in the manager
// component and src/lib/products/actions.ts.

export default async function ProductsPage() {
  const { t } = await getServerMessages();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const products = await listProducts();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-2xl font-semibold text-atelier-ink">{t.studio.productsTitle}</h1>
      <p className="mt-1 text-sm text-atelier-muted">{t.studio.productsSubtitle}</p>
      <div className="mt-6">
        <ProductsManager initial={products} />
      </div>
    </div>
  );
}
