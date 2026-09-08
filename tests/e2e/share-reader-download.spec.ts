/**
 * R5-4 — the public reader's file-header Download button (a lucide
 * `Download` icon next to the existing copy button, `codeBlock.tsx`'s
 * `onDownload` prop / `ShareApp.tsx`'s `RenderedSourceHeader`). Exercises
 * the real client mechanism end to end: `fetchShareRawBlob` hits
 * `GET /share/{id}?download=1` (server/app/routers/share_public.py), and
 * `lib/browserDownload.ts::triggerBrowserDownload` saves the resulting
 * `Blob` via a temporary `<a download>` click — a real browser download
 * event, not a plain link navigation.
 *
 * Own vault path (`vault/notes/download-target.csv`) so this file's publish
 * never races the other `share-*.spec.ts` files' own shares — same
 * discipline `share-reader.spec.ts`'s module doc explains.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { createFileWithContent, publishFileViaContextMenu, signInToShareBackend } from "./shareUiHelpers";

test.describe("public reader — Download button", () => {
  test("clicking Download on a CSV share saves the file under its original name", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const csvContent = "name,age\nAda,36\nGrace,85\n";
    const csvPath = await createFileWithContent(page, "vault/notes", "download-target.csv", csvContent);
    const link = await publishFileViaContextMenu(page, {
      treePath: csvPath,
      generalAccess: "link",
      renderMode: "rendered",
    });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);
    await expect(secondPage.getByTestId("share-content")).toBeVisible();

    const downloadPromise = secondPage.waitForEvent("download");
    await secondPage.getByRole("button", { name: "Download file" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("download-target.csv");

    await secondContext.close();
  });

  test("a markdown share never offers a Download button", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFileViaContextMenu(page, {
      treePath: "vault/notes/markdown-kitchen-sink.md",
      generalAccess: "link",
      renderMode: "rendered",
    });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);
    await expect(secondPage.getByTestId("share-content")).toBeVisible();
    await expect(secondPage.getByRole("button", { name: "Download file" })).toHaveCount(0);

    await secondContext.close();
  });
});
