const {hasMagic, sync} = require('glob')
const {dirname, resolve, relative, extname, basename} = require('path')
const template = require('babel-template')

const requireTemplate = template('INTEROP(require(FILE)).default')

function getImportNames (specifiers) {
  const typeHandlers = {
    'ImportDefaultSpecifier': (imports, specifier) => imports.defaultName = specifier.local.name,
    'ImportNamespaceSpecifier': (imports, specifier) => imports.defaultName = specifier.local.name,
    'ImportSpecifier': (imports, specifier) => imports.destructured.push({local: specifier.local.name, imported: specifier.imported.name})
  }
  return specifiers.reduce((imports, specifier) => {
    const handle = typeHandlers[specifier.type]
    if (handle) handle(imports, specifier)
    return imports
  }, {defaultName: false, destructured: []})
}

function findFiles(pattern, state) {
  const {globOptions = {}} = state.opts || {}
  if (!hasMagic(pattern, globOptions)) return
  const resolvedPattern = resolve(dirname(state.file.opts.filename), pattern)
  const resolvedPatternDirectory = dirname(resolvedPattern).replace(/\/\*.*/,'')
  const files = sync(normalize(resolvedPattern), {...globOptions, strict: true, nodir: true})
    .map(path => {
      const segments = relative(resolvedPatternDirectory, path).split('/')
      const file = segments[segments.length - 1]
      const name = basename(file, extname(file))
      return {directories: segments.slice(0,segments.length - 1), name, path: relative(dirname(state.file.opts.filename), path)}
    })
    .reduce((acc, {directories, name, path}) => {
      let directory = acc
      directories.forEach(name => directory = directory[name] = {})
      directory[name] = path
      return acc
    },{})
  return files
}

function toObject(t, state, source) {
 const {stringLiteral, objectExpression, objectProperty} = t
 switch (typeof(source)) {
   case 'object': return objectExpression(
     Object.entries(source).map(([key, value]) => objectProperty(stringLiteral(key), toObject(t, state, value)))
   ) 
   default: return toRequire(t, state, source)
 }
}

function toRequire({stringLiteral}, state, name) {
  const {prefix = "./", prefixes = {}} = state.opts || {}
  const specific = prefixes[extname(name)]
  const file = `${specific == undefined ? prefix: specific}${name}`
  return requireTemplate({
    INTEROP: state.file.addHelper('interopRequireDefault'),
    FILE: stringLiteral(file)
  }).expression
}

function normalize (pattern) {
  return process.platform === 'win32' ? pattern.replace(/\\/g, '/') : pattern
}

module.exports = function ({types: t}) {
  return {
    visitor: {
      ImportDeclaration(path, state) {

        const matches = findFiles(path.node.source.value, state) 

        if (!matches) return
        const {defaultName, destructured} = getImportNames(path.node.specifiers)

        const replacements = (
          defaultName
          ? [t.variableDeclaration('const', [t.variableDeclarator(t.identifier(defaultName), toObject(t, state, matches))])]
          : []
        ).concat(
          destructured.map(item => t.variableDeclaration('const', [t.variableDeclarator(t.identifier(item.local), toObject(t, state, matches[item.imported]))]))
        )
        path.replaceWithMultiple(replacements)
      }
    }
  }
}

