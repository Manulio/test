"use server";

import { confirmReviewMatch, getDb, rejectReviewMatch } from "@precios/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/** Vuelve a la misma página de la revisión, con el resultado para mostrar un aviso. */
function back(form: FormData, result: string): never {
  const sp = new URLSearchParams({ hecho: result });
  const page = Number(form.get("pagina"));
  if (page > 1) sp.set("pagina", String(page));
  revalidatePath("/", "layout");
  redirect(`/admin/revisar?${sp}`);
}

export async function confirmAction(form: FormData) {
  back(form, await confirmReviewMatch(getDb(), Number(form.get("listado"))));
}

export async function rejectAction(form: FormData) {
  const ok = await rejectReviewMatch(getDb(), Number(form.get("listado")));
  back(form, ok ? "rejected" : "not-found");
}
