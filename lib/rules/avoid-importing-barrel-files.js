/**
 * @fileoverview avoid-barrel-files
 * @author Pascal Schilp
 */
//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

import { readFileSync } from "fs";
import path from "path";
import { builtinModules } from "module";
import {
	count_module_graph_size,
	is_barrel_file,
} from "@devinmdavies/eslint-barrel-file-utils/index.cjs";
import { ResolverFactory } from "oxc-resolver";
import multimatch from "multimatch";

/**
 * @fileoverview Avoid importing barrel files
 * @author Pascal Schilp
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const cache = {};

// custom error class to emulate oxc_resolver ResolveError enum.
// `errorVariant` can be equal to a `ResolveError` enum variant.
class ResolveError extends Error {
	constructor(errorVariant = null, message = "") {
		super(message);
		this.errorVariant = errorVariant;
		this.message = message;
	}
}

export default {
	meta: {
		type: "problem",
		fixable: null,
		docs: {
			description: "Avoid importing barrel files",
			recommended: true,
			url: "../../docs/rules/avoid-importing-barrel-files.md",
		},
		schema: [
			{
				allowList: {
					type: "array",
					description: "List of modules from which to allow barrel files",
					default: [],
					uniqueItems: true,
					items: {
						type: "string",
					},
				},
			},
			{
				ignore: {
					type: "array",
					description: "List of files to ignore",
					default: [],
					uniqueItems: true,
					items: {
						type: "string",
					},
				},
			},
			{
				maxModuleGraphSizeAllowed: {
					type: "number",
					description: "Maximum allowed module graph size",
					default: 20,
				},
			},
			{
				amountOfExportsToConsiderModuleAsBarrel: {
					type: "number",
					description: "Amount of exports to consider a module as barrel file",
					default: 3,
				},
			},
			{
				debug: {
					type: "boolean",
					description: "Enabling debug loggin",
					default: false,
				},
			},
			{
				exportConditions: {
					type: "array",
					description:
						"Export conditions to use to resolve bare module specifiers",
					default: [],
					uniqueItems: true,
					items: {
						type: "string",
					},
				},
			},
			{
				mainFields: {
					type: "array",
					description: "Main fields to use to resolve modules",
					default: [],
					uniqueItems: true,
					items: {
						type: "string",
					},
				},
			},
			{
				extensions: {
					type: "array",
					description: "Extensions to use to resolve modules",
					default: [],
					uniqueItems: true,
					items: {
						type: "string",
					},
				},
			},
			// schema to match oxc-resolver's TsconfigOptions
			{
				tsconfig: {
					type: "object",
					description: "Options to TsconfigOptions",
					properties: {
						configFile: {
							type: "string",
							description: "Relative path to the configuration file",
						},
						references: {
							type: "array",
							description: "Typescript Project References",
							items: {
								type: "string",
							},
						},
					},
				},
			},
			// NapiResolveOptions.alias
			{
				alias: {
					type: "object",
					description: "Webpack aliases used in imports or requires",
				},
			},
		],
	},
	create(context) {
		const options = context.options?.[0] || {};
		const maxModuleGraphSizeAllowed = options.maxModuleGraphSizeAllowed ?? 20;
		const debug = options.debug ?? false;
		const amountOfExportsToConsiderModuleAsBarrel =
			options.amountOfExportsToConsiderModuleAsBarrel ?? 3;
		const exportConditions = options.exportConditions ?? ["node", "import"];
		const mainFields = options.mainFields ?? ["module", "browser", "main"];
		const extensions = options.extensions ?? [
			".js",
			".ts",
			".tsx",
			".jsx",
			".json",
			".node",
		];
		const ignore = options.ignore ?? [];
		const tsconfig = options.tsconfig;
		const alias = options.alias;

		const resolutionOptions = {
			exportConditions,
			mainFields,
			extensions,
			tsconfig,
			alias,
		};

		const resolver = new ResolverFactory({
			tsconfig,
			alias,
			conditionNames: exportConditions,
			mainFields,
			extensions,
		});

		/**
		 * @param {string} specifier
		 * @returns {boolean}
		 */
		const isBareModuleSpecifier = (specifier) =>
			!!specifier?.replace(/'/g, "")[0].match(/[@a-zA-Z]/g);

		/**
		 * @param {number} amount
		 * @returns {string}
		 */
		const message = (amount, specifier) =>
			`The imported module "${specifier}" is a barrel file, which leads to importing a module graph of ${amount} modules, which exceeds the maximum allowed size of ${maxModuleGraphSizeAllowed} modules`;

		return {
			ImportDeclaration(node) {
				const moduleSpecifier = node.source.value;
				const currentFileName = context.getFilename();

				if (options?.allowList?.includes(moduleSpecifier)) {
					return;
				}

				if (node?.importKind === "type") {
					return;
				}

				if (builtinModules.includes(moduleSpecifier.replace("node:", ""))) {
					return;
				}

				let resolvedPath;
				try {
					resolvedPath = resolver.sync(
						path.dirname(currentFileName),
						moduleSpecifier,
					);

					if (resolvedPath.error) {
						// assuming ResolveError::NotFound if ResolveResult's path value is None
						if (!resolvedPath.path) {
							throw new ResolveError("NotFound", resolvedPath.error);
						}

						throw new ResolveError(null, resolvedPath.error);
					}
				} catch (e) {
					if (!debug) {
						return;
					}

					if (e instanceof ResolveError) {
						switch (e.errorVariant) {
							case "NotFound":
								console.error(
									`Failed to resolve "${moduleSpecifier}" from "${currentFileName}": \n\n${e.stack}`,
								);
								break;
							default:
								console.error(`${e.message}: \n\n${e.stack}`);
						}
					}

					console.error(`${e}: \n\n${e.stack}`);
					return;
				}

				console.log('resolvedPath.path: '.resolvedPath.path);

				const ignoredPaths = multimatch([resolvedPath.path], ignore);

				console.log(ignoredPaths)

				if (ignore.length && ignoredPaths.includes(resolvedPath.path)) {
					return;
				}

				const fileContent = readFileSync(resolvedPath.path, "utf8");
				let isBarrelFile;

				/**
				 * Only cache bare module specifiers, as local files can change
				 */
				if (isBareModuleSpecifier(moduleSpecifier)) {
					/**
					 * The module specifier is not cached yet, so we need to analyze and cache it
					 */
					if (!cache[moduleSpecifier]) {
						isBarrelFile = is_barrel_file(
							fileContent,
							amountOfExportsToConsiderModuleAsBarrel,
						);
						const moduleGraphSize = isBarrelFile
							? count_module_graph_size(resolvedPath.path, resolutionOptions)
							: -1;

						cache[moduleSpecifier] = {
							isBarrelFile,
							moduleGraphSize,
						};

						if (moduleGraphSize > maxModuleGraphSizeAllowed) {
							context.report({
								node: node.source,
								message: message(moduleGraphSize, moduleSpecifier),
							});
						}
					} else {
						/**
						 * It is a bare module specifier, but cached, so we can use the cached value
						 */

						if (
							cache[moduleSpecifier].moduleGraphSize > maxModuleGraphSizeAllowed
						) {
							context.report({
								node: node.source,
								message: message(
									cache[moduleSpecifier].moduleGraphSize,
									moduleSpecifier,
								),
							});
						}
					}
				} else {
					/**
					 * Its not a bare module specifier, but local module, so we need to analyze it
					 */
					const isBarrelFile = is_barrel_file(
						fileContent,
						amountOfExportsToConsiderModuleAsBarrel,
					);
					const moduleGraphSize = isBarrelFile
						? count_module_graph_size(resolvedPath.path, resolutionOptions)
						: -1;
					if (moduleGraphSize > maxModuleGraphSizeAllowed) {
						context.report({
							node: node.source,
							message: message(moduleGraphSize, moduleSpecifier),
						});
					}
				}
			},
		};
	},
};
