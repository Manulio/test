import { describe, expect, it } from "vitest";
import { CATEGORIES, categorize, categoryName } from "./index";

describe("categorize", () => {
  it.each([
    ["Leche Entera Conaprole 1 L", "lacteos"],
    ["Dulce de leche Conaprole 1 kg", "lacteos"],
    ["Huevos colorados x 12", "lacteos"],
    ["Arroz Saman Blanco 1kg", "almacen"],
    ["Yerba Canarias 500 g", "almacen"],
    ["Chocolate con leche Milka 100 g", "almacen"],
    ["Snack de arroz sin gluten sabor queso 80 g", "almacen"],
    ["Fideos al huevo Adria spaghetti 500 g", "almacen"],
    ["Canela molida Monte Cudine", "almacen"],
    ["Coca-Cola 1,5 lt", "bebidas"],
    ["Tinto Tannat Piedra Sola", "bebidas"],
    ["Agua Salus sin gas 600 ml", "bebidas"],
    ["Asado premium x 500 g", "carnes"],
    ["Jamón cocido Sarubbi 200 g", "fiambres"],
    ["Manzana Fuji malla x 2 kg", "frutas-y-verduras"],
    ["Papas fritas Lays 30 g", "almacen"],
    ["Pan lactal Bimbo 500 g", "panaderia"],
    ["Molde para pan Tramontina 30 cm", "hogar"],
    ["Helado Conaprole dulce de leche 1 L", "congelados"],
    ["Detergente Hurra limón 500 ml", "limpieza"],
    ["Crema dental Colgate 90 g", "perfumeria"],
    ["Jabón Dove 90 g", "perfumeria"],
    ["Jabón en polvo Skip 3 kg", "limpieza"],
    ["Pañales Huggies XG x 30", "bebes"],
    ["Orejas de cerdo Dog Goods", "mascotas"],
    ["Alimento One kitten pollo y carne 500 g", "mascotas"],
    ["Camiseta manga corta Arkitect talle M", "ropa"],
    ["Licuadora Moulinex 500 W", "electro"],
    ["Peluche Hello Kitty 30 cm", "jugueteria"],
    ["Set x 4 jarros de vidrio 300 ml", "hogar"],
    ["Adivina quién?", "jugueteria"],
    ["Producto misterioso", "otros"],
  ])("%s → %s", (name, slug) => {
    expect(categorize(name)).toBe(slug);
  });

  it("si el nombre no alcanza, usa la marca", () => {
    expect(categorize("Colet 1 L", "Conaprole")).toBe("lacteos");
    expect(categorize("Producto misterioso", "Marca rara")).toBe("otros");
  });

  it("toda categoría devuelta existe", () => {
    expect(categoryName(categorize("Leche"))).toBe("Lácteos y huevos");
    expect(new Set(CATEGORIES.map((c) => c.slug)).size).toBe(CATEGORIES.length);
  });
});
