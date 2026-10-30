const assert = require('node:assert');
const test = require('node:test');
const ts = require('typescript');
const {
  parseSelector,
  renameLocations,
  scanTemplate,
  selectorLocations,
  targetAt,
} = require('../plugin/selector-rename.js');

const names = list => list.map(({kind, name}) => `${kind} ${name}`);

test('selectors yield element and attribute names', () => {
  assert.deepEqual(names(parseSelector('app-card')), ['element app-card']);
  assert.deepEqual(names(parseSelector('[app-highlight]')), ['attribute app-highlight']);
  assert.deepEqual(names(parseSelector('button[app-button], a[app-button]')), [
    'element button',
    'element a',
    'attribute app-button',
    'attribute app-button',
  ]);
  const [attribute] = parseSelector('[app-highlight]');
  assert.equal('[app-highlight]'.slice(attribute.start, attribute.end), 'app-highlight');
});

test('templates yield tag names and bound attribute names', () => {
  const template = [
    '<app-card [title]="a < b" app-highlight (click)="go()">',
    '  <!-- <app-card> -->',
    '  {{ a<b }} <input [(value)]="draft" disabled/>',
    '</app-card>',
  ].join('\n');
  assert.deepEqual(names(scanTemplate(template)), [
    'element app-card',
    'attribute title',
    'attribute app-highlight',
    'element input',
    'attribute value',
    'attribute disabled',
    'element app-card',
  ]);
  for (const name of scanTemplate(template)) assert.equal(template.slice(name.start, name.end), name.name);
});

function project(files) {
  const sourceFiles = Object.entries(files)
    .filter(([fileName]) => fileName.endsWith('.ts'))
    .map(([fileName, text]) => ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true));
  const htmlFiles = () => Object.keys(files).filter(fileName => fileName.endsWith('.html'));
  return {ts, sourceFiles: () => sourceFiles, readFile: fileName => files[fileName], htmlFiles};
}

const files = {
  '/app/highlight.ts': "@Directive({ selector: '[app-highlight]' })\nexport class Highlight {}\n",
  '/app/card.ts': "@Component({ selector: 'app-card', template: '<p app-highlight>card</p>' })\nexport class Card {}\n",
  '/app/home.ts': "@Component({ selector: 'app-home', templateUrl: './home.html' })\nexport class Home {}\n",
  '/app/home.html': '<app-card app-highlight></app-card>\n<app-cards></app-cards>\n',
  '/index.html': '<body><app-home></app-home></body>\n',
};

test('a selector renames with its uses in inline and external templates', () => {
  const sources = project(files);
  const offset = files['/app/highlight.ts'].indexOf('app-highlight');
  const target = targetAt(sources, '/app/highlight.ts', offset + 2);
  assert.deepEqual({kind: target.kind, name: target.name}, {kind: 'attribute', name: 'app-highlight'});
  const found = renameLocations(sources, target).map(({fileName, start, end}) => [fileName, (files[fileName] ?? '').slice(start, end)]);
  assert.deepEqual(found, [
    ['/app/highlight.ts', 'app-highlight'],
    ['/app/card.ts', 'app-highlight'],
    ['/app/home.html', 'app-highlight'],
  ]);
});

test('a tag in a template renames the component selector and both tags', () => {
  const sources = project(files);
  const target = targetAt(sources, '/app/home.html', files['/app/home.html'].indexOf('app-card') + 1);
  const found = renameLocations(sources, target).map(({fileName, start}) => [fileName, start]);
  assert.deepEqual(found, [
    ['/app/card.ts', files['/app/card.ts'].indexOf('app-card')],
    ['/app/home.html', 1],
    ['/app/home.html', files['/app/home.html'].indexOf('/app-card>') + 1],
  ]);
});

test('a root component renames in the HTML page that hosts it', () => {
  const sources = project(files);
  const target = targetAt(sources, '/app/home.ts', files['/app/home.ts'].indexOf('app-home'));
  const found = renameLocations(sources, target).map(({fileName, start, end}) => [fileName, files[fileName].slice(start, end)]);
  assert.deepEqual(found, [
    ['/app/home.ts', 'app-home'],
    ['/index.html', 'app-home'],
    ['/index.html', 'app-home'],
  ]);
});

test('go to definition leads from a tag or an attribute to its selector', () => {
  const sources = project(files);
  const text = fileName => files[fileName];
  const definition = (fileName, name) => {
    const target = targetAt(sources, fileName, text(fileName).indexOf(name) + 1);
    return [target.source, selectorLocations(sources, target).map(({fileName, start, end}) => [fileName, start, text(fileName).slice(start, end)])];
  };
  const homeSelector = ['/app/home.ts', text('/app/home.ts').indexOf('app-home'), 'app-home'];
  const cardSelector = ['/app/card.ts', text('/app/card.ts').indexOf('app-card'), 'app-card'];
  const highlightSelector = ['/app/highlight.ts', text('/app/highlight.ts').indexOf('app-highlight'), 'app-highlight'];
  assert.deepEqual(definition('/index.html', 'app-home'), ['template', [homeSelector]]);
  assert.deepEqual(definition('/app/home.html', 'app-card'), ['template', [cardSelector]]);
  assert.deepEqual(definition('/app/card.ts', 'app-highlight>'), ['template', [highlightSelector]]);
  assert.equal(definition('/app/card.ts', "'app-card'")[0], 'selector');
});

test('names that no selector declares are left to other rename providers', () => {
  const sources = project(files);
  const target = targetAt(sources, '/app/home.html', files['/app/home.html'].indexOf('app-cards') + 1);
  assert.equal(renameLocations(sources, target), undefined);
});
