import * as t from 'babel-types'

import {
  getJSXStyleInfo,
  processCss,
  cssToBabelType,
  validateExternalExpressions,
  combinePlugins
} from './_utils'

const isModuleExports = t.buildMatchMemberExpression('module.exports')

function getTagNameFromImportDeclaration(path) {
  if (path.node.source.value === 'styled-jsx/css') {
    return path.node.specifiers[0].local.name
  }
}

function processTaggedTemplateExpression({
  path,
  tagName,
  fileInfo,
  splitRules,
  plugins,
  vendorPrefix
}) {
  if (path.node.tag.name !== tagName) {
    return
  }

  const templateLiteral = path.get('quasi')

  // Check whether there are undefined references or references to this.something (e.g. props or state)
  validateExternalExpressions(templateLiteral)

  const stylesInfo = getJSXStyleInfo(templateLiteral)

  const globalStyles = processCss(
    {
      ...stylesInfo,
      hash: `${stylesInfo.hash}0`,
      fileInfo,
      isGlobal: true,
      plugins,
      vendorPrefix
    },
    { splitRules }
  )

  const scopedStyles = processCss(
    {
      ...stylesInfo,
      hash: `${stylesInfo.hash}1`,
      fileInfo,
      isGlobal: false,
      plugins,
      vendorPrefix
    },
    { splitRules }
  )

  const id = path.parentPath.node.id
  const baseExportName = id ? id.name : 'default'
  let parentPath =
    baseExportName === 'default'
      ? path.parentPath
      : path.findParent(
          path =>
            path.isVariableDeclaration() ||
            (path.isAssignmentExpression() &&
              isModuleExports(path.get('left').node))
        )

  if (baseExportName !== 'default' && !parentPath.parentPath.isProgram()) {
    parentPath = parentPath.parentPath
  }

  const hashesAndScoped = {
    hash: globalStyles.hash,
    scoped: cssToBabelType(scopedStyles.css),
    scopedHash: scopedStyles.hash
  }

  const globalCss = cssToBabelType(globalStyles.css)

  // default exports

  if (baseExportName === 'default') {
    const defaultExportIdentifier = path.scope.generateUidIdentifier(
      'defaultExport'
    )
    parentPath.insertBefore(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          defaultExportIdentifier,
          t.isArrayExpression(globalCss)
            ? globalCss
            : t.newExpression(t.identifier('String'), [globalCss])
        )
      ])
    )
    parentPath.insertBefore(
      makeHashesAndScopedCssPaths(defaultExportIdentifier, hashesAndScoped)
    )
    path.replaceWith(defaultExportIdentifier)
    return
  }

  // named exports

  parentPath.insertAfter(
    makeHashesAndScopedCssPaths(t.identifier(baseExportName), hashesAndScoped)
  )
  path.replaceWith(
    t.isArrayExpression(globalCss)
      ? globalCss
      : t.newExpression(t.identifier('String'), [globalCss])
  )
}

function makeHashesAndScopedCssPaths(exportIdentifier, data) {
  return Object.keys(data).map(key => {
    const value =
      typeof data[key] === 'string' ? t.stringLiteral(data[key]) : data[key]

    return t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.memberExpression(exportIdentifier, t.identifier(`__${key}`)),
        value
      )
    )
  })
}

let plugins
export const visitor = {
  ImportDeclaration(path, state) {
    const tagName = getTagNameFromImportDeclaration(path)
    if (!tagName) {
      return
    }

    state.jsxTag = tagName
    path.remove()
  },
  TaggedTemplateExpression(path, state) {
    const { vendorPrefix } = state.opts
    processTaggedTemplateExpression({
      path,
      tagName: state.jsxTag,
      fileInfo: {
        file: state.file,
        sourceFileName: state.file.opts.sourceFileName,
        sourceMaps: state.file.opts.sourceMaps
      },
      splitRules:
        typeof state.opts.optimizeForSpeed === 'boolean'
          ? state.opts.optimizeForSpeed
          : process.env.NODE_ENV === 'production',
      plugins: state.plugins,
      vendorPrefix: typeof vendorPrefix === 'boolean' ? vendorPrefix : true
    })
  }
}

export default function() {
  return {
    Program(path, state) {
      if (!plugins) {
        const { sourceMaps, vendorPrefix } = state.opts
        plugins = combinePlugins(state.opts.plugins, {
          sourceMaps: sourceMaps || state.file.opts.sourceMaps,
          vendorPrefix: typeof vendorPrefix === 'boolean' ? vendorPrefix : true
        })
      }
      state.plugins = plugins
    },
    ...visitor
  }
}
