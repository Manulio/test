import { expect, test, type Page } from "@playwright/test";

// Recorrido básico sobre los datos de demo (packages/db/scripts/demo-data.ts).

const LECHE_EAN = "7730900571104";

async function search(page: Page, q: string) {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Buscar producto" }).fill(q);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
}

/** Un bloque de la página por su título (para las secciones sin nombre accesible). */
const section = (page: Page, title: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

/** Las tarjetas de la grilla del catálogo, en orden. */
const cards = (page: Page) => page.getByRole("article");

test("buscar “leche” trae la leche primero", async ({ page }) => {
  await search(page, "leche");
  await expect(page).toHaveURL(/\?q=leche$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resultados para “leche”");
  await expect(cards(page).first().getByRole("heading")).toHaveText(/^Leche .*Conaprole/i);
  await expect(cards(page).first()).toContainText("3 supermercados");
  // El dulce de leche también aparece, pero después.
  await expect(cards(page).filter({ hasText: /Dulce de leche/i })).toHaveCount(1);
});

test("una búsqueda mal escrita muestra parecidos", async ({ page }) => {
  await search(page, "yerva");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Parecidos a “yerva”");
  await expect(cards(page).first().getByRole("heading")).toHaveText(/Yerba/i);
});

test("un código de barras en el buscador lleva a la ficha", async ({ page }) => {
  await search(page, LECHE_EAN);
  await expect(page).toHaveURL(/\/producto\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Leche .*Conaprole/i);
  await expect(page.getByText(`EAN ${LECHE_EAN}`)).toBeVisible();
});

test("la ficha muestra las ofertas de cada cadena y el historial", async ({ page }) => {
  await page.goto(`/ean/${LECHE_EAN}`);
  await expect(page).toHaveURL(/\/producto\/\d+$/);

  // Ofertas de la más barata a la más cara.
  const offers = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: /^(Disco|Tienda Inglesa|Ta-Ta)$/ }) });
  await expect(offers).toHaveCount(3);
  await expect(offers.first()).toContainText("Ta-Ta");
  await expect(offers.first()).toContainText("51");
  await expect(offers.last()).toContainText("Tienda Inglesa");

  const history = page.getByRole("region", { name: "Historial de precios" });
  await expect(history).toBeVisible();
  await expect(history.getByRole("img", { name: /^Precio en .*Ta-Ta/ })).toBeVisible();
  await history.getByText("Ver los datos").click();
  // 4 fechas (hoy y las 3 semanas anteriores) en cada una de las 3 cadenas.
  await expect(history.getByRole("row")).toHaveCount(1 + 4 * 3);
});

test("agregar a la lista y ver el total en /lista", async ({ page }) => {
  await page.goto(`/ean/${LECHE_EAN}`);
  await page.getByRole("button", { name: "+ Agregar a la lista" }).click();
  const stepper = page.getByRole("group", { name: /^Cantidad de / });
  await expect(stepper).toContainText("1");
  await stepper.getByRole("button", { name: "Agregar uno" }).click();
  await expect(stepper).toContainText("2");

  await page.goto("/lista");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mi lista");
  await expect(page.getByRole("link", { name: /^Leche .*Conaprole/i })).toBeVisible();

  // 2 leches a $51 en Ta-Ta, la más barata.
  const best = section(page, "Comprando todo en un solo lugar");
  await expect(best).toContainText("Ta-Ta");
  await expect(best).toContainText("102");
  const totals = section(page, "Total por cadena").getByRole("listitem");
  await expect(totals).toHaveCount(3);
  await expect(totals.first()).toContainText("Ta-Ta");
});

test("/ofertas lista los productos rebajados", async ({ page }) => {
  await page.goto("/ofertas");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ofertas de hoy");
  await expect(page.getByText(/^3 productos rebajados/)).toBeVisible();
  // Del mayor descuento al menor: aceite en Ta-Ta (119 → 99), Coca-Cola en Disco (105 → 89), arroz en Disco (79 → 69).
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).first()).toContainText("−17 %");
  await expect(cards(page).first()).toContainText(/Aceite/i);
  await expect(page.getByRole("article").filter({ hasText: /Arroz/i })).toContainText("Disco");
});

test("/comparar arma el ranking de cadenas", async ({ page }) => {
  await page.goto("/comparar");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Comparar supermercados");
  const ranking = page.getByRole("table").first();
  await expect(page.getByRole("heading", { name: "Ranking de precios" })).toBeVisible();
  for (const chain of ["Disco", "Tienda Inglesa", "Ta-Ta"]) await expect(ranking).toContainText(chain);
  await expect(page.getByRole("link", { name: "Descargar planilla (CSV)" })).toBeVisible();
});
