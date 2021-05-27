const visit = require("unist-util-visit");
const toString = require("mdast-util-to-string");

const remarkKbd = require('remark-kbd');

module.exports = ({ markdownAST }, pluginOptions) => {
  console.log("markdownAST",markdownAST)
  const {useDefaultStyles = true, className = "", style } = pluginOptions;


  visit(markdownAST, "paragraph", (node) => {

    let para = toString(node)
    const syntax = /\+\+((?!\+\+).)*\+\+/ig
    const matches = para.match(syntax);

    if (matches !== null) {
      console.log("keyboard-->match", node);

      const removeSymbols = text => text.replace(/\+\+/g, "")

      const putTextInSpan = text =>
        `<kbd
          ${useDefaultStyles && style ? ` style='${style}'` : ""}
          ${className !== "" ? `class='${className}'` : ""}
        >${removeSymbols(text)}</kbd>`

      matches.map(match => {
        para = para.replace(match, putTextInSpan(match))
      })
      para = '<p>' + para + '</p>'
      node.type = "html"
      node.children = undefined
      node.value = para
    }
  });

  return markdownAST;
};
