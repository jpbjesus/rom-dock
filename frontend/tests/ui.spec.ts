import { test, expect, type Page } from "@playwright/test";
const folder = (name: string) => ({
  name,
  size: 0,
  modified: 1700000000,
  directory: true,
  symlink: false,
});
const file = (name: string) => ({ ...folder(name), directory: false, size: 4 });
async function mock(page: Page, handler?: (route: any) => Promise<boolean>) {
  await page.route("**/api/**", async (route) => {
    if (handler && (await handler(route))) return;
    const url = new URL(route.request().url());
    if (url.pathname === "/api/status")
      return route.fulfill({
        json: {
          connected: true,
          host: "192.0.2.10",
          generation: "g1",
          storage: { total: 64e9, used: 20e9, free: 44e9 },
        },
      });
    if (url.pathname === "/api/files")
      return route.fulfill({ json: { entries: [file("game.sfc")] } });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Biblioteca de ROMs", level: 1 }),
  ).toBeVisible();
}
test("failed navigation never exposes previous folder entries", async ({
  page,
}) => {
  await mock(page, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname !== "/api/files") return false;
    if (u.searchParams.get("path") === "B")
      await route.fulfill({
        status: 502,
        json: { detail: "Pasta indisponível" },
      });
    else await route.fulfill({ json: { entries: [folder("A"), folder("B")] } });
    return true;
  });
  await page.getByRole("button", { name: "Abrir B", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Pasta indisponível");
  await expect(
    page.getByRole("button", { name: "Abrir A", exact: true }),
  ).toHaveCount(0);
});
test("download failure is shown inside the application", async ({ page }) => {
  await mock(page, async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/download")
      return false;
    await route.fulfill({
      status: 404,
      json: { detail: "O ficheiro já não existe." },
    });
    return true;
  });
  await page.getByRole("button", { name: "Descarregar game.sfc" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "O ficheiro já não existe.",
  );
  await expect(
    page.getByRole("heading", { name: "Biblioteca de ROMs", level: 1 }),
  ).toBeVisible();
});
test("upload, overwrite confirmation and completed queue", async ({ page }) => {
  const uploads: string[] = [];
  await mock(page, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname !== "/api/upload") return false;
    uploads.push(u.searchParams.get("overwrite")!);
    if (u.searchParams.get("overwrite") === "false")
      await route.fulfill({
        status: 409,
        json: { detail: "Já existe um ficheiro com este nome." },
      });
    else await route.fulfill({ json: { ok: true } });
    return true;
  });
  await page.getByLabel("Selecionar ficheiros para enviar").setInputFiles({
    name: "game.sfc",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("new!"),
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Substituir", exact: true }).click();
  await expect(page.getByText("Na consola · 4 B")).toBeVisible();
  expect(uploads).toEqual(["false", "true"]);
});
test("rename and delete require explicit actions", async ({ page }) => {
  const mutations: string[] = [];
  await mock(page, async (route) => {
    const u = new URL(route.request().url());
    if (["/api/rename", "/api/entry"].includes(u.pathname)) {
      mutations.push(route.request().method() + " " + u.pathname);
      await route.fulfill({ json: { ok: true } });
      return true;
    }
    return false;
  });
  await page.getByRole("button", { name: "Renomear game.sfc" }).click();
  await page.getByRole("dialog").getByLabel("Nome").fill("ação.sfc");
  await page.getByRole("button", { name: "Guardar nome" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Eliminar game.sfc" }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(mutations).toEqual(["POST /api/rename"]);
  await page.getByRole("button", { name: "Eliminar game.sfc" }).click();
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect
    .poll(() => mutations)
    .toEqual(["POST /api/rename", "DELETE /api/entry"]);
});
test("expired session returns to access code form", async ({ page }) => {
  await mock(page, async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/files") return false;
    await route.fulfill({
      status: 401,
      json: { detail: "Introduz o código de acesso da app." },
    });
    return true;
  });
  await expect(page.getByLabel("Código de acesso")).toBeVisible();
});
test("cancelled upload stays cancelled and the next file finishes", async ({
  page,
}) => {
  await mock(page, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname !== "/api/upload") return false;
    if (u.searchParams.get("path") === "first.sfc") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ json: { ok: true } }).catch(() => {});
    } else await route.fulfill({ json: { ok: true } });
    return true;
  });
  await page.getByLabel("Selecionar ficheiros para enviar").setInputFiles([
    {
      name: "first.sfc",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("aaaa"),
    },
    {
      name: "second.sfc",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("bbbb"),
    },
  ]);
  await page.getByRole("button", { name: "Cancelar first.sfc" }).click();
  await expect(page.getByText("Envio cancelado.")).toBeVisible();
  await expect(page.getByText("Na consola · 4 B")).toBeVisible();
});
test("continuous compact explorer filters all items without pagination", async ({
  page,
}) => {
  await mock(page, async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/files") return false;
    await route.fulfill({
      json: {
        entries: [
          folder("snes"),
          ...Array.from({ length: 39 }, (_, i) => folder("system-" + i)),
        ],
      },
    });
    return true;
  });
  await expect(page.locator(".file-card")).toHaveCount(40);
  await expect(
    page.getByRole("button", { name: "Página seguinte", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Ordenar ficheiros" }),
  ).toHaveCount(0);
  await page.getByPlaceholder("Pesquisar nesta pasta…").fill("Super Nintendo");
  await expect(page.locator(".file-card")).toHaveCount(1);
  await page.getByPlaceholder("Pesquisar nesta pasta…").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".file-card")).toHaveCount(40);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Vista em lista", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Ficheiros e pastas" }),
  ).toHaveClass(/list-view/);
});
test("visible sort fields support ascending and descending order", async ({
  page,
}) => {
  await mock(page, async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/files") return false;
    await route.fulfill({
      json: {
        entries: [
          { ...file("Alpha.sfc"), size: 20, modified: 100 },
          { ...file("Beta.sfc"), size: 4, modified: 300 },
          { ...file("Gamma.sfc"), size: 10, modified: 200 },
        ],
      },
    });
    return true;
  });
  const names = () => page.locator(".card-name").allTextContents();
  await expect.poll(names).toEqual(["Alpha.sfc", "Beta.sfc", "Gamma.sfc"]);
  await page.getByRole("button", { name: "Tamanho", exact: true }).click();
  await expect.poll(names).toEqual(["Alpha.sfc", "Gamma.sfc", "Beta.sfc"]);
  await page.getByRole("button", { name: "Tamanho", exact: true }).click();
  await expect.poll(names).toEqual(["Beta.sfc", "Gamma.sfc", "Alpha.sfc"]);
  await page.getByRole("button", { name: "Modificado", exact: true }).click();
  await expect.poll(names).toEqual(["Beta.sfc", "Gamma.sfc", "Alpha.sfc"]);
  await page.getByRole("button", { name: "Nome", exact: true }).click();
  await expect.poll(names).toEqual(["Alpha.sfc", "Beta.sfc", "Gamma.sfc"]);
});
test("desktop information remains visible without opening a file", async ({
  page,
}) => {
  await mock(page);
  await expect(
    page.getByRole("complementary", { name: "Informação da biblioteca" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Selecionar game.sfc", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Informação da biblioteca" }),
  ).toContainText("game.sfc");
});
test("application uses neutral interface language", async ({ page }) => {
  await mock(page);
  await expect(page.locator("body")).not.toContainText("A TUA");
  await expect(page.locator("body")).not.toContainText("O próximo jogo");
  await expect(page.locator("body")).not.toContainText("próxima partida");
});
test("file explorer exposes real file details and responsive information panel", async ({
  page,
}) => {
  await mock(page);
  await expect(page.locator(".library-layout")).toBeVisible();
  await page
    .getByRole("button", { name: "Informação sobre game.sfc", exact: true })
    .click();
  const panel = page.getByRole("complementary", {
    name: "Informação da biblioteca",
  });
  await expect(panel).toContainText("game.sfc");
  await expect(panel).toContainText("4 B");
  await expect(panel).toContainText("192.0.2.10");
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(panel).toBeVisible();
  await page
    .getByRole("button", { name: "Fechar informação", exact: true })
    .click();
  await expect(panel).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("automatic import has been removed completely", async ({ page }) => {
  await mock(page);
  await expect(page.locator("input[webkitdirectory]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Importar/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Enviar ficheiros", exact: true }),
  ).toBeVisible();
});

test("file explorer provides a working context menu", async ({ page }) => {
  await mock(page);
  await page
    .locator(".file-card")
    .filter({ hasText: "game.sfc" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Renomear", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Nome")).toHaveValue(
    "game.sfc",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
});

test("information rail fills the right edge from top to bottom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mock(page);
  const bounds = await page
    .getByRole("complementary", { name: "Informação da biblioteca" })
    .boundingBox();
  expect(bounds?.y).toBe(0);
  expect(bounds?.height).toBe(900);
  expect(Math.round((bounds?.x || 0) + (bounds?.width || 0))).toBe(1440);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("context menu supports keyboard navigation and restores focus", async ({
  page,
}) => {
  await mock(page);
  const trigger = page.getByRole("button", {
    name: "Selecionar game.sfc",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Pré-visualizar", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Descarregar", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "Eliminar", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("large folders append files while scrolling without pagination", async ({
  page,
}) => {
  await mock(page, async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/files") return false;
    await route.fulfill({
      json: {
        entries: Array.from({ length: 500 }, (_, i) =>
          file("game-" + String(i).padStart(4, "0") + ".sfc"),
        ),
      },
    });
    return true;
  });
  await expect(page.locator(".file-card")).toHaveCount(120);
  for (const expected of [240, 360, 480, 500]) {
    await page.locator(".finder-main").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.locator(".file-card")).toHaveCount(expected);
  }
  await expect(
    page.getByRole("button", { name: "Selecionar game-0499.sfc", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Página seguinte", exact: true }),
  ).toHaveCount(0);
});

test("grid size is adjustable and the user preference survives reload", async ({
  page,
}) => {
  await mock(page);
  const slider = page.getByRole("slider", {
    name: "Tamanho dos ícones",
    exact: true,
  });
  await expect(slider).toHaveValue("144");
  const initial = await page.locator(".card-icon").first().boundingBox();
  await slider.fill("200");
  await expect(slider).toHaveValue("200");
  const larger = await page.locator(".card-icon").first().boundingBox();
  expect(larger!.height).toBeGreaterThan(initial!.height);
  await page.reload();
  await expect(
    page.getByRole("slider", { name: "Tamanho dos ícones", exact: true }),
  ).toHaveValue("200");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("search and filter controls stay at the top during scrolling", async ({
  page,
}) => {
  await mock(page, async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/files") return false;
    await route.fulfill({
      json: {
        entries: Array.from({ length: 200 }, (_, i) =>
          file("game-" + i + ".sfc"),
        ),
      },
    });
    return true;
  });
  await expect(page.locator(".browser-sticky-controls")).toBeVisible();
  await page.locator(".finder-main").evaluate((el) => {
    el.scrollTop = 700;
  });
  const controls = await page.locator(".browser-sticky-controls").boundingBox(),
    toolbar = await page.locator(".finder-toolbar").boundingBox();
  expect(controls!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height - 1);
  expect(controls!.y).toBeLessThanOrEqual(toolbar!.y + toolbar!.height + 1);
  await page.getByPlaceholder("Pesquisar nesta pasta…").fill("game-199.sfc");
  await expect(page.locator(".file-card")).toHaveCount(1);
});

test("light mode switch persists and remains responsive", async ({ page }) => {
  await mock(page);
  const toggle = page.getByRole("button", { name: "Claro", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Claro", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/tmp/romdock-light-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.getByRole("button", { name: "Escuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("system folders use local icons without changing explorer navigation", async ({
  page,
}) => {
  await mock(page, async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/files") return false;
    await route.fulfill({
      json: { entries: [folder("snes"), folder("gba"), folder("psx")] },
    });
    return true;
  });
  await expect(
    page.locator('.folder-system-badge [data-system-icon="snes"]'),
  ).toBeVisible();
  await expect(
    page.locator('.folder-system-badge [data-system-icon="gba"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Abrir Super Nintendo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Super Nintendo",
      exact: true,
    }),
  ).toBeVisible();
});

test("manual cover management reads, uploads, chooses and removes associations", async ({
  page,
}) => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  let version = 1,
    removed = false;
  const operations: any[] = [];
  let current = "snes/images/original.png";
  await mock(page, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/api/files") {
      await route.fulfill({
        json: {
          entries: url.searchParams.get("path")
            ? [file("game.sfc")]
            : [folder("snes")],
        },
      });
      return true;
    }
    if (url.pathname === "/api/covers") {
      await route.fulfill({
        json: {
          revision: "r" + version,
          covers: removed
            ? {}
            : { "game.sfc": { image: current, version: String(version) } },
        },
      });
      return true;
    }
    if (url.pathname === "/api/cover") {
      if (request.method() === "GET")
        await route.fulfill({
          json: {
            revision: "r" + version,
            cover: removed
              ? null
              : { image: current, version: String(version) },
            images: [
              {
                name: "other.png",
                image: "snes/images/other.png",
                version: "1",
              },
            ],
          },
        });
      else {
        operations.push({
          method: request.method(),
          body:
            request.method() === "POST"
              ? JSON.parse(request.postData()!)
              : request.postDataBuffer()?.length,
        });
        version++;
        if (request.method() === "POST") {
          const body = JSON.parse(request.postData()!);
          removed = !!body.remove;
          if (body.image_path) current = body.image_path;
        } else {
          current = "snes/images/uploaded.png";
          removed = false;
        }
        await route.fulfill({ json: { ok: true } });
      }
      return true;
    }
    if (url.pathname === "/api/image") {
      await route.fulfill({ contentType: "image/png", body: image });
      return true;
    }
    return false;
  });
  await page
    .getByRole("button", { name: "Abrir Super Nintendo", exact: true })
    .click();
  await expect(page.locator(".rom-cover")).toBeVisible();
  await page
    .getByRole("button", { name: "Selecionar game.sfc", exact: true })
    .click();
  await page.getByRole("button", { name: "Alterar capa", exact: true }).click();
  await page
    .getByLabel("Selecionar imagem para capa")
    .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: image });
  const preview = page.getByRole("img", {
    name: "Pré-visualização da nova capa",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await page.getByRole("button", { name: "Guardar capa", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Gerir capa", exact: true }),
  ).not.toBeVisible();
  await expect.poll(() => operations.length).toBe(1);
  expect(operations[0].method).toBe("PUT");
  await page.getByRole("button", { name: "Alterar capa", exact: true }).click();
  await page.getByRole("button", { name: /Imagens na consola/ }).click();
  await page
    .getByRole("button", { name: "Usar other.png", exact: true })
    .click();
  await page.getByRole("button", { name: "Guardar capa", exact: true }).click();
  await expect.poll(() => operations.length).toBe(2);
  expect(operations[1].body.image_path).toBe("snes/images/other.png");
  await page.getByRole("button", { name: "Remover capa", exact: true }).click();
  await page
    .getByRole("button", { name: "Remover associação", exact: true })
    .click();
  await expect.poll(() => operations.length).toBe(3);
  expect(operations[2].body.remove).toBe(true);
  await expect(page.locator(".rom-cover")).toHaveCount(0);
});

test("completed uploads explain how to update games on the console", async ({
  page,
}) => {
  await mock(page);
  await page.getByLabel("Selecionar ficheiros para enviar").setInputFiles({
    name: "example.sfc",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("ROM"),
  });
  await expect(
    page
      .getByText("START → Game Settings → Update Gamelists", { exact: true })
      .first(),
  ).toBeVisible();
});

test("sidebar can collapse and the theme has explicit visible choices", async ({
  page,
}) => {
  await mock(page);
  await page.getByRole("button", { name: "Claro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("button", { name: "Encolher barra lateral", exact: true })
    .click();
  await expect(page.locator(".finder-shell")).toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "Escuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator(".finder-shell")).toHaveClass(/sidebar-collapsed/);
  await page
    .getByRole("button", { name: "Expandir barra lateral", exact: true })
    .click();
});

test("file preview safely displays text and is reachable with Space", async ({
  page,
}) => {
  await mock(page, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/preview") {
      await route.fulfill({
        json: {
          name: "game.sfc",
          kind: "binary",
          size: 4,
          modified: 1700000000,
          text: "00000000  52 4f 4d 00  ROM.",
          truncated: false,
        },
      });
      return true;
    }
    return false;
  });
  const file = page.getByRole("button", {
    name: "Selecionar game.sfc",
    exact: true,
  });
  await file.focus();
  await page.keyboard.press("Space");
  const preview = page.getByRole("dialog", {
    name: "Pré-visualização",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("52 4f 4d");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
});

test("mobile back button and edge gesture return to the previous folder", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/files") {
      await route.fulfill({
        json: {
          entries: url.searchParams.get("path")
            ? [file("game.sfc")]
            : [folder("snes")],
        },
      });
      return true;
    }
    return false;
  });
  await page
    .getByRole("button", { name: "Abrir Super Nintendo", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retroceder", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retroceder", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Biblioteca de ROMs" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Abrir Super Nintendo", exact: true })
    .click();
  await page.locator(".finder-main").evaluate((el) => {
    el.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        touches: [
          new Touch({ identifier: 1, target: el, clientX: 10, clientY: 300 }),
        ],
      }),
    );
    el.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        changedTouches: [
          new Touch({ identifier: 1, target: el, clientX: 140, clientY: 305 }),
        ],
      }),
    );
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "Biblioteca de ROMs" }),
  ).toBeVisible();
});

test("disconnected page focuses on connection and shows one actionable error", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/status")
      return route.fulfill({ json: { connected: false } });
    if (u.pathname === "/api/connect")
      return route.fulfill({
        status: 502,
        json: {
          detail:
            "A consola recusou a ligação SSH. Confirmar que o serviço SSH está ativo.",
        },
      });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ligar a consola", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar ficheiros", exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("Endereço IP").fill("192.168.1.100");
  await page.getByLabel("Palavra-passe SSH").fill("example");
  await page
    .getByRole("button", { name: "Ligar à consola", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText("serviço SSH");
  await page.screenshot({
    path: "/tmp/romdock-connection-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Claro", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Ligar à consola", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/romdock-connection-mobile.png",
    fullPage: true,
  });
});

test("both desktop sidebars collapse independently and persist", async ({
  page,
}) => {
  await mock(page);
  await page
    .getByRole("button", { name: "Encolher informação", exact: true })
    .click();
  await expect(page.locator(".finder-shell")).toHaveClass(/info-collapsed/);
  await expect(
    page.getByRole("button", {
      name: "Expandir painel de informação",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Encolher barra lateral", exact: true })
    .click();
  await expect(page.locator(".finder-shell")).toHaveClass(/sidebar-collapsed/);
  await page.reload();
  await expect(page.locator(".finder-shell")).toHaveClass(/info-collapsed/);
  await expect(page.locator(".finder-shell")).toHaveClass(/sidebar-collapsed/);
  await page
    .getByRole("button", { name: "Expandir painel de informação", exact: true })
    .click();
  await expect(page.locator(".library-info").first()).toContainText("CONSOLA");
});

test("favorite systems persist and ROM filters exclude media-only folders", async ({
  page,
}) => {
  await mock(page, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/files") {
      await route.fulfill({
        json: { entries: [folder("snes"), folder("gba"), folder("nes")] },
      });
      return true;
    }
    if (u.pathname === "/api/systems") {
      await route.fulfill({
        json: { systems: { snes: true, gba: false, nes: null } },
      });
      return true;
    }
    return false;
  });
  await page
    .getByRole("button", {
      name: "Adicionar aos favoritos: Super Nintendo",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Sistemas favoritos" }),
  ).toContainText("Super Nintendo");
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Sistemas favoritos" }),
  ).toContainText("Super Nintendo");
  await page.getByLabel("Filtrar sistemas").selectOption("with");
  await expect(page.locator(".file-card")).toHaveCount(1);
  await expect(page.locator(".file-card")).toContainText("Super Nintendo");
  await page.getByLabel("Filtrar sistemas").selectOption("without");
  await expect(page.locator(".file-card")).toHaveCount(1);
  await expect(page.locator(".file-card")).toContainText("Game Boy Advance");
  await page.getByRole("button", {name:"Ver todos os sistemas", exact:true}).click();
  await expect(page.getByLabel("Filtrar sistemas")).toHaveValue("all");
  await expect(page.locator(".file-card")).toHaveCount(3);
  await page.getByRole("button", {name:"Encolher barra lateral",exact:true}).click();
  await expect(page.getByRole("navigation",{name:"Sistemas favoritos"}).locator(".system-icon")).toBeVisible();
});

test("list system icons retain compact geometry after increasing grid size", async ({
  page,
}) => {
  await mock(page, async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/files") return false;
    await route.fulfill({ json: { entries: [folder("snes"), folder("gba")] } });
    return true;
  });
  await page.getByRole("slider", { name: "Tamanho dos ícones" }).fill("208");
  await page
    .getByRole("button", { name: "Vista em lista", exact: true })
    .click();
  const badge = page.locator(".list-view .folder-system-badge").first();
  expect((await badge.boundingBox())!.width).toBeLessThanOrEqual(18);
  const icon = page.locator(".list-view .card-icon").first();
  expect((await icon.boundingBox())!.height).toBeLessThanOrEqual(34);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await icon.evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("1e-05s");
});
