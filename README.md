# Environment Transfer Tool

The Environment Transfer Tool is a WIP tool that has been used successfully by employees and clients of CHILI publish to transfer hundreds of megabytes of data between environments.

While this is a WIP, it still has real value. There is still the possibility of errors.

# Usage

## Prerequisites

1. Install [Bun](https://bun.sh/docs/installation)
2. Clone or download the repo
3. Install dependencies with `bun install`

## Getting Started

Start the server:

```bash
bun server.ts
```

Then open your browser to `http://localhost:3001`.

## Using the Web UI

The web interface has two panels — a **Source** panel for browsing resources and a **Destination** panel for the target environment.

### 1. Connect to your environments

Enter the URL, username, and password for both your **source** (where resources live now) and **destination** (where you want them transferred). Click **Connect** for each. A green status indicator confirms a successful connection.

### 2. Browse and select resources

Choose a resource type from the dropdown (e.g. Documents, Assets, Fonts, PdfExportSettings, etc.).

Depending on the resource type, you can browse in two ways:
- **Tree mode** — navigate folders with breadcrumb navigation (Documents, Assets, Fonts, DocumentTemplates, WorkSpaces, etc.)
- **Search mode** — search by name with paginated results (PdfExportSettings, DataSources, Users, etc.)

Click items to select them. A counter shows how many items are selected.

### 3. Transfer

Click **Transfer Selected** to start the transfer. A progress overlay shows real-time streaming logs so you can follow along. When the transfer completes, you'll see a summary of successes and errors.

### Note on Documents
When you transfer Documents, it will automatically transfer all the assets, fonts, barcodes, datasource settings, and snippets that the document uses.

---

## CLI Usage (Legacy)

The tool can also be used directly via the CLI by editing and running `index.ts`.

1. Edit `index.ts` to configure your source and destination environments:

```javascript
const src = await generateConnectorWithKey({ url: "https://ft-nostress.chili-publish.online", username: "", password: "" });
const dest = await generateConnectorWithKey({ url: "https://cp-htf-227.chili-publish.online/", username: "", password: "" });
```

2. Update `username` and `password` with credentials that have the correct permissions.

3. Configure the items to transfer. For example, to transfer two documents:

```javascript
await transferItems({
  dest: dest, src: src, resource: "Documents", items: [
    "876e1d04-241b-421b-7c60-a772ec0c3f45",
    "911e1d02-223b-123b-8b50-b442ef1c0e34",
  ]
});
```

You can chain multiple `transferItems` calls for different resource types:

```javascript
await transferItems({
  dest: dest, src: src, resource: "Documents", items: [
    "876e1d04-241b-421b-7c60-a772ec0c3f45",
  ]
});

await transferItems({
  dest: dest, src: src, resource: "PdfExportSettings", items: [
    "0c147681-7074-42ed-b4cc-b4296c7e6c8a",
  ]
});
```

4. Run with `bun index.ts`

---

# Credit
This tool has its origins in https://github.com/austin-meier/chilitools-public, so thanks to Austin Meier for his work. The first version is very much a rewrite of the migration portion of that tool.
