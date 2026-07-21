import fs from 'node:fs';
import path from 'node:path';

function getManifestResources(manifest) {
  return [...new Set([
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((contentScript) => [
      ...contentScript.js,
      ...contentScript.css,
    ]),
    ...manifest.web_accessible_resources.flatMap(({ resources }) => resources),
  ])];
}

function invalidManifest(pathName, expectation) {
  throw new Error(`Invalid extension manifest: ${pathName} must be ${expectation}`);
}

function requireObject(value, pathName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalidManifest(pathName, 'an object');
  }
  return value;
}

function requireArray(value, pathName) {
  if (!Array.isArray(value)) {
    invalidManifest(pathName, 'an array');
  }
  return value;
}

function requireString(value, pathName) {
  if (typeof value !== 'string' || value.length === 0) {
    invalidManifest(pathName, 'a non-empty string');
  }
  return value;
}

function requireStringArray(value, pathName) {
  return requireArray(value, pathName).map((entry, index) => (
    requireString(entry, `${pathName}[${index}]`)
  ));
}

function validateManifestShape(value) {
  const manifest = requireObject(value, 'root');
  const background = requireObject(manifest.background, 'background');
  const contentScripts = requireArray(manifest.content_scripts, 'content_scripts');
  const webAccessibleResources = requireArray(
    manifest.web_accessible_resources,
    'web_accessible_resources',
  );

  return {
    background: {
      service_worker: requireString(background.service_worker, 'background.service_worker'),
    },
    content_scripts: contentScripts.map((entry, index) => {
      const pathName = `content_scripts[${index}]`;
      const contentScript = requireObject(entry, pathName);
      return {
        js: requireStringArray(contentScript.js, `${pathName}.js`),
        css: contentScript.css === undefined
          ? []
          : requireStringArray(contentScript.css, `${pathName}.css`),
      };
    }),
    web_accessible_resources: webAccessibleResources.map((entry, index) => {
      const pathName = `web_accessible_resources[${index}]`;
      const webAccessibleResource = requireObject(entry, pathName);
      return {
        resources: requireStringArray(webAccessibleResource.resources, `${pathName}.resources`),
      };
    }),
  };
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveResource(root, resource) {
  const resolved = path.resolve(root, resource);
  if (!isWithin(root, resolved)) {
    throw new Error(`Extension resource escapes project root: ${resource}`);
  }
  return resolved;
}

function validateResource(sourceRoot, resource) {
  const source = resolveResource(sourceRoot, resource);
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing extension resource: ${resource}`);
  }
  const realSource = fs.realpathSync(source);
  if (!isWithin(sourceRoot, realSource)) {
    throw new Error(`Extension resource escapes project root: ${resource}`);
  }
  return realSource;
}

function validateManifest(sourceRoot) {
  const manifestPath = path.join(sourceRoot, 'manifest.json');
  if (!fs.statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Missing extension manifest');
  }
  const realManifestPath = fs.realpathSync(manifestPath);
  if (!isWithin(sourceRoot, realManifestPath)) {
    throw new Error('Extension manifest escapes project root');
  }
  return realManifestPath;
}

function readManifest(manifestPath) {
  try {
    return validateManifestShape(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid extension manifest: expected valid JSON');
    }
    throw error;
  }
}

function rejectOutputOverlap(realOutputRoot, source, message) {
  if (isWithin(realOutputRoot, source)) {
    throw new Error(message);
  }
}

function resolveRealPath(target) {
  let existingPath = path.resolve(target);
  const missingSegments = [];
  while (!fs.statSync(existingPath, { throwIfNoEntry: false })) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      throw new Error(`Unable to resolve path: ${target}`);
    }
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parent;
  }
  return path.join(fs.realpathSync(existingPath), ...missingSegments);
}

function validateOutputRoot(outputRoot) {
  const output = fs.lstatSync(outputRoot, { throwIfNoEntry: false });
  if (!output) {
    return;
  }
  if (output.isSymbolicLink()) {
    throw new Error('Output root must not be a symbolic link');
  }
  if (!output.isDirectory()) {
    throw new Error('Output root must be a directory');
  }
}

function buildExtension(sourceArgument, outputArgument) {
  if (!sourceArgument || !outputArgument) {
    throw new Error('Usage: node scripts/build-extension.js <source-root> <output-root>');
  }
  const sourceRoot = fs.realpathSync(sourceArgument);
  const outputRoot = path.resolve(outputArgument);
  validateOutputRoot(outputRoot);
  const realOutputRoot = resolveRealPath(outputRoot);
  if (sourceRoot === realOutputRoot) {
    throw new Error('Output root must differ from source root');
  }
  if (isWithin(realOutputRoot, sourceRoot)) {
    throw new Error('Output root must not contain source root');
  }

  const manifestPath = validateManifest(sourceRoot);
  rejectOutputOverlap(realOutputRoot, manifestPath, 'Extension manifest overlaps output root');
  const manifest = readManifest(manifestPath);
  const resources = getManifestResources(manifest);
  const resolvedResources = resources.map((resource) => ({
    resource,
    source: validateResource(sourceRoot, resource),
  }));
  for (const { resource, source } of resolvedResources) {
    rejectOutputOverlap(realOutputRoot, source, `Extension resource overlaps output root: ${resource}`);
  }
  const preparedResources = resolvedResources.map(({ resource, source }) => ({
    resource,
    contents: fs.readFileSync(source),
  }));

  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.copyFileSync(manifestPath, path.join(outputRoot, 'manifest.json'));
  for (const { resource, contents } of preparedResources) {
    const destination = resolveResource(outputRoot, resource);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }
}

try {
  buildExtension(process.argv[2], process.argv[3]);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
