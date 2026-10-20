import { normalizeText } from "./normalize";

/** Categorías propias del catálogo. Son las mismas para todas las cadenas, así se puede recorrer y comparar. */
export const CATEGORIES = [
  { slug: "almacen", name: "Almacén" },
  { slug: "bebidas", name: "Bebidas" },
  { slug: "lacteos", name: "Lácteos y huevos" },
  { slug: "carnes", name: "Carnes y pescados" },
  { slug: "fiambres", name: "Fiambres" },
  { slug: "frutas-y-verduras", name: "Frutas y verduras" },
  { slug: "panaderia", name: "Panadería" },
  { slug: "congelados", name: "Congelados" },
  { slug: "limpieza", name: "Limpieza" },
  { slug: "perfumeria", name: "Perfumería" },
  { slug: "bebes", name: "Bebés" },
  { slug: "mascotas", name: "Mascotas" },
  { slug: "hogar", name: "Hogar y bazar" },
  { slug: "electro", name: "Electro y tecnología" },
  { slug: "ropa", name: "Ropa y calzado" },
  { slug: "jugueteria", name: "Juguetería y librería" },
  { slug: "otros", name: "Otros" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

/** Las categorías de la compra del súper (sin hogar, electro, ropa ni juguetería). */
export const GROCERY_CATEGORIES: CategorySlug[] = [
  "almacen", "bebidas", "lacteos", "carnes", "fiambres", "frutas-y-verduras", "panaderia", "congelados",
  "limpieza", "perfumeria", "bebes", "mascotas",
];

export function categoryName(slug: string): string | null {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? null;
}

/**
 * Términos por categoría. En los nombres el tipo de producto suele ir primero ("snack sabor queso",
 * "fideos al huevo"), así que gana el término que aparece antes; si dos empiezan en el mismo lugar,
 * el más largo ("dulce de leche" le gana a "dulce*"), y si no, el de la regla que está primero.
 * Cada palabra de un término tiene que estar completa (acepta plural) o, si termina en "*", es un prefijo.
 */
const RULES: [CategorySlug, string[]][] = [
  ["mascotas", ["perro", "gato", "cachorro", "mascota", "dog", "cat", "kitten", "puppy", "primogato", "primocao", "alimento para*", "alimento* balanceado*", "collar* para*", "correa* para*", "dog chow", "cat chow", "pedigree", "whiskas", "excellent", "arena sanitaria"]],
  ["bebes", ["pañal*", "toallitas humedas", "babysec", "huggies", "pampers", "mamadera", "chupete", "bebe", "baby"]],
  [
    "ropa",
    [
      "camiseta*", "remera*", "musculosa*", "buzo*", "campera*", "canguro*", "pantalon*", "short*", "bermuda*", "jean*",
      "vestido*", "pollera*", "calza*", "media*", "soquete*", "boxer*", "bombacha*", "corpiño*", "pijama*", "camisa*",
      "chaleco*", "sweater*", "saco*", "championes", "zapatilla*", "zapato*", "sandalia*", "ojota*", "bota*", "pantufla*",
      "talle*",
    ],
  ],
  [
    "electro",
    [
      "televisor*", "tv", "smart tv", "celular*", "smartphone", "tablet*", "notebook*", "laptop", "monitor*", "parlante*",
      "auricular*", "cable*", "cargador*", "joystick*", "consola*", "mouse", "teclado*", "impresora*", "pendrive", "bluetooth",
      "maquina*", "licuadora*", "batidora*", "procesadora*", "minipimer", "tostadora*", "cafetera*", "microondas", "horno*", "cocina electrolux", "camara*", "microfono*", "vincha gaming", "headset*", "juego ps*", "ps5", "nintendo",
      "freidora*", "heladera*", "lavarropa*", "secarropa*", "lavavajilla*", "aire acondicionado", "ventilador*",
      "estufa*", "calefactor*", "caloventor*", "aspiradora*", "plancha* a vapor", "plancha de ropa", "secador* de pelo",
      "planchita*", "rizador*", "campana*", "anafe*", "cocina a gas", "termotanque*", "extractor*", "exprimidor* electrico",
      "pava* electrica*", "sandwichera*", "waflera*", "yogurtera*", "motorola", "samsung galaxy", "iphone", "xiaomi",
      "lampara*", "foco*", "led", "linterna*", "pila*", "bateria*", "alargue*", "zapatilla electrica", "toma*", "enchufe*",
    ],
  ],
  [
    "jugueteria",
    [
      "juguete*", "masa de moldear", "domino*", "naipe*", "cubreasiento*", "plastilina*", "cartulina*", "regla*", "flauta*", "flotador*", "libro*", "muñeca*", "peluche*", "juego de mesa", "rompecabeza*", "puzzle*", "lego", "pelota*", "triciclo*",
      "tripatin*", "monopatin*", "bicicleta*", "patines", "cuaderno*", "carpeta*", "lapiz*", "lapicera*", "boligrafo*", "marcador*",
      "crayon*", "goma de borrar", "cartuchera*", "mochila*", "tijera escolar", "hoja* de dibujo", "resma*", "agenda*",
      "hello kitty", "paw patrol", "frozen", "spiderman", "barbie", "hot wheels", "adivina quien",
    ],
  ],
  [
    "hogar",
    [
      "plato*", "vaso*", "copa*", "taza*", "jarra*", "cubierto*", "cuchillo*", "tenedor*", "cuchara*", "olla*", "sarten*",
      "cacerola*", "bifera*", "plancha grill", "fuente*", "bandeja*", "tupper*", "hermetico*", "frasco*", "termo*",
      "botella termica", "individual*", "mantel*", "repasador*", "agarradera*", "toalla*", "toallon*", "sabana*",
      "acolchado*", "frazada*", "manta*", "almohada*", "cortina*", "alfombra*", "funda*", "cojin*", "almohadon*",
      "portarretrato*", "cuadro*", "lamina*", "espejo*", "vela*", "florero*", "maceta*", "planta artificial", "guirnalda*",
      "adorno*", "arbol de navidad", "estrella federal", "colgador*", "perchero*", "percha*", "organizador*", "canasto*",
      "caja organizadora", "silla*", "mesa*", "banco*", "estante*", "rack*", "sofa*", "colchon*", "reposera*", "sombrilla*",
      "parrilla*", "brasero*", "carbon", "leña", "herramienta*", "taladro*", "lijadora*", "destornillador*", "martillo*",
      "pinza*", "llave* inglesa*", "tornillo*", "pernos", "tuerca*", "clavo*", "cinta electrica", "cinta adhesiva",
      "pegamento*", "pintura*", "rodillo*", "pincel*", "manguera*", "regadera*", "candado*", "escalera*", "timer de cocina",
      "rallador*", "colador*", "molde*", "porta*", "mate", "mates", "bombilla*", "ceramica*", "papel manteca", "papel de horno", "exprimidor*", "utensil*", "piedra*", "jarro*", "jarron*", "cuenco*", "pote*", "lunchera*", "tabla de planchar", "asiento para inodoro", "tirador*", "manopla*", "bolsa reutilizable", "bolsa de compra*", "brocha*", "mecha*", "cuerda*", "hidrolavadora*", "fregadora*", "cerca*", "esfera*", "colgante*", "llavero*", "abrelata*", "sacacorcho*", "tabla de picar", "tabla* para*", "bolsa de regalo", "bolbolsa*",
    ],
  ],
  [
    "limpieza",
    [
      "detergente", "lavandina", "suavizante", "jabon en polvo", "jabon liquido para ropa", "jabon para ropa",
      "quitamanchas", "limpiador", "limpia*", "cloro", "lavacoche*", "desengrasante", "desinfectante", "lustramuebles", "cera para piso*",
      "insecticida", "raid", "esponja", "trapo", "rejilla", "bolsa* de residuo*", "bolsa* residuo*", "papel de cocina",
      "rollo de cocina", "servilleta", "aromatizante", "desodorante de ambiente", "fosforo*", "escoba*", "balde*", "cera*", "lustra*", "secador de piso", "palo de piso", "pala de residuo*", "guante* de latex", "film", "papel aluminio", "pastilla* para inodoro", "pato purific*",
    ],
  ],
  [
    "perfumeria",
    [
      "shampoo", "champu", "acondicionador", "crema dental", "pasta dental", "cepillo dental", "cepillo de diente*",
      "enjuague bucal", "hilo dental", "desodorante", "antitranspirante", "jabon", "gel de ducha", "afeitar", "afeitadora",
      "maquina de afeitar", "espuma de afeitar", "toalla* femenina*", "toallita*", "tampon*", "protector* diario*",
      "papel higienico", "algodon", "hisopo*", "crema corporal", "crema de mano*", "protector solar", "bronceador",
      "repelente", "colonia", "perfume", "maquillaje", "esmalte", "tintura", "agua micelar", "agua oxigenada", "alcohol en gel", "alcohol", "locion*", "corrector*", "base de maquillaje", "labial*", "mascara de pestaña*", "delineador*", "rubor", "sombra* de ojo*", "pinza de ceja*", "crema* facial*", "serum", "talco", "coloracion*", "prestobarba*", "accesorio* para cabello", "liga* para cabello", "eau de*", "cinta kinesiologica", "curita*", "preservativo*", "nivea", "dove", "rexona", "colgate", "gillette",
    ],
  ],
  [
    "bebidas",
    [
      "agua", "agua mineral", "refresco", "gaseosa", "soda", "coca cola", "coca", "pepsi", "sprite", "fanta", "seven up",
      "7up", "paso de los toros", "nix", "cerveza", "vino", "espumante", "sidra", "champagne", "whisky", "vodka", "gin",
      "ron", "fernet", "grappa", "grapamiel", "licor", "aperitivo", "vermouth", "campari", "jugo", "bebida*", "energizante",
      "isotonica", "gatorade", "powerade", "tonica", "cola", "espumoso*", "malbec", "tannat", "cabernet*", "merlot", "sauvignon*", "chardonnay", "syrah", "rosado", "tinto", "blanc", "brut", "moscato", "cognac", "tequila", "caña", "amargo", "jugo* en polvo", "clight", "tang", "bebida* vegetal*",
    ],
  ],
  ["congelados", ["congelad*", "helado", "hielo", "papas prefritas", "papas fritas congeladas", "nuggets", "patitas", "freezer", "croqueta*", "empanada*", "tarta* congelada*"]],
  [
    "almacen",
    [
      // Golosinas, conservas y salsas que nombran ingredientes de otras categorías.
      "chocolate*", "huevo* de pascua*", "pastilla*", "chupetin*", "alfajor*", "bombon*", "caramelo*", "golosina*", "chicle*", "galletita*", "galleta*", "bizcochuelo",
      "dulce de membrillo", "dulce de batata", "mermelada", "pure de tomate", "pulpa de tomate", "tomate triturado",
      "tomate perita", "salsa*", "ketchup", "mayonesa", "mostaza", "caldo*", "sopa*", "atun", "sardina*", "conserva*",
      "en lata", "arveja*", "choclo en grano", "lenteja*", "poroto*", "garbanzo*", "aceituna*", "leche en polvo",
      "leche de coco", "cafe con leche", "pepinillo*", "encurtido*", "pimenton", "turron*", "damasco* deshidratado*", "fruta* seca*", "deshidratad*", "pasa* de uva", "ciruela* pasa*", "sardinilla*", "caballa*", "palmito*", "champiñon* en lata", "duraznos en almibar", "en almibar", "barra* de cereal*", "cereal* en barra*", "mani con chocolate", "budin*", "pan dulce", "canela", "castaña*", "tuco", "bicarbonato", "chia", "lino", "sesamo", "quinoa", "chips", "semilla*", "mix de frutos secos",
    ],
  ],
  [
    "lacteos",
    [
      "leche", "yogur*", "queso*", "muzzarella", "mozzarella", "ricota", "manteca", "crema de leche", "dulce de leche",
      "postre", "flan", "huevo*", "margarina", "colet", "conaprole", "calcar",
    ],
  ],
  [
    "fiambres",
    ["jamon", "salame*", "salamin*", "mortadela", "panceta", "bondiola", "lomito", "fiambre*", "paleta cocida", "leberwurst", "pate"],
  ],
  [
    "carnes",
    [
      "carne", "vacuno", "pollo", "suprema", "pechuga", "muslo*", "cerdo", "cordero", "nalga", "asado", "colita de cuadril",
      "lomo", "bife", "longaniza*", "costilla*", "entraña*", "carre*", "ternera", "pulpa de bondiola", "maximo* de pollo", "entrecot", "vacio", "matambre", "picada", "molida", "milanesa*", "chorizo*", "morcilla*",
      "salchicha*", "hamburguesa*", "medallon*", "pescado", "merluza", "salmon", "camaron*", "langostino*", "mariscos",
    ],
  ],
  [
    "frutas-y-verduras",
    [
      "manzana", "banana", "naranja", "mandarina", "limon", "pera", "durazno", "uva", "frutilla", "frambuesa*", "arandano*", "kiwi", "anana", "melon",
      "sandia", "palta", "papa", "boniato", "cebolla", "ajo", "tomate", "lechuga", "zanahoria", "zapallo", "zapallito",
      "zucchini", "morron", "pimiento", "pepino", "berenjena", "brocoli", "coliflor", "espinaca", "acelga", "repollo",
      "choclo", "remolacha", "apio", "perejil", "albahaca", "champinon*", "hongo*", "fruta*", "verdura*", "hortaliza*",
    ],
  ],
  ["panaderia", ["pan", "pan de molde", "pan lactal", "bizcocho*", "medialuna*", "tortuga*", "baguette", "galleta de campaña", "masa*", "tapa* de empanada*", "pascualina", "prepizza*", "pizza*", "grisin*", "tostada*"]],
  [
    "almacen",
    [
      "arroz", "fideo*", "pasta*", "tallarin*", "ravioles", "sorrentino*", "ñoqui*", "noqui*", "harina*", "polenta",
      "azucar", "edulcorante", "sal", "aceite*", "vinagre", "yerba*", "cafe", "te", "mate cocido", "cacao", "cereal*",
      "avena", "granola", "maiz", "pimienta", "oregano", "condimento*", "especias", "levadura", "gelatina", "premezcla",
      "snack*", "papas fritas", "mani", "nueces", "almendra*", "pochoclo*", "miel", "dulce*",
    ],
  ],
];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Un término como regexp. Cada palabra que termina en "*" es un prefijo ("bolsa* de residuo*");
 * las demás tienen que estar completas, aceptando plural.
 */
function termPattern(term: string): string {
  return term
    .split(" ")
    .map((word) => {
      const prefix = word.endsWith("*");
      const body = escape(normalizeText(prefix ? word.slice(0, -1) : word));
      return prefix ? `${body}[a-z0-9]*` : `${body}(?:s|es)?`;
    })
    .join(" ");
}

/** Categorías que ganan aunque el término aparezca al final ("orejas de cerdo dog goods" es para perros). */
const PRIORITY: CategorySlug[] = ["mascotas"];

const COMPILED = RULES.map(([slug, terms]) => ({
  slug,
  // Dentro de una alternancia gana la primera opción que coincide, por eso van las más largas primero.
  re: new RegExp(`(?:^| )(${[...terms].sort((a, b) => b.length - a.length).map(termPattern).join("|")})(?= |$)`),
}));

function bestMatch(text: string): CategorySlug | null {
  let best: { slug: CategorySlug; index: number; length: number } | null = null;
  for (const { slug, re } of COMPILED) {
    const m = re.exec(text);
    if (!m) continue;
    if (PRIORITY.includes(slug)) return slug;
    const index = m.index + m[0].length - m[1]!.length;
    const length = m[1]!.length;
    if (!best || index < best.index || (index === best.index && length > best.length)) best = { slug, index, length };
  }
  return best?.slug ?? null;
}

/** Categoría de un producto a partir de su nombre (y si no alcanza, su marca). Si nada coincide, "otros". */
export function categorize(name: string, brand?: string | null): CategorySlug {
  return bestMatch(normalizeText(name)) ?? (brand ? bestMatch(normalizeText(brand)) : null) ?? "otros";
}
