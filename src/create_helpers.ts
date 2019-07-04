import * as ts from 'typescript';
import { warn } from './logger';
import {
    createFunctionParams,
    createFunctionReturnType,
    createTypeLiteral,
    resolveHeritageClauses,
    resolveType,
    resolveTypeParameters
} from './type_resolve_helpers';
import { PropTree } from "./PropTree";

const declareModifier = ts.createModifier(ts.SyntaxKind.DeclareKeyword);
const constModifier = ts.createModifier(ts.SyntaxKind.ConstKeyword);
const readonlyModifier = ts.createModifier(ts.SyntaxKind.ReadonlyKeyword);
const abstractModifier = ts.createModifier(ts.SyntaxKind.AbstractKeyword);

function validateClassLikeChildren(children: ts.Node[] | undefined, validate: (n: ts.Node) => boolean, msg: string)
{
    // Validate that the children array actually contains type elements.
    // This should never trigger, but is here for safety.
    if (children)
    {
        for (let i = children.length - 1; i >= 0; --i)
        {
            const child = children[i];
            if (!validate(child))
            {
                warn(`Encountered child that is not a ${msg}, this is likely due to invalid JSDoc.`, child);
                children.splice(i, 1);
            }
        }
    }
}

function validateClassChildren(children: ts.Node[] | undefined)
{
    return validateClassLikeChildren(children, ts.isClassElement, 'ClassElement');
}

function validateInterfaceChildren(children: ts.Node[] | undefined)
{
    return validateClassLikeChildren(children, ts.isTypeElement, 'TypeElement');
}

function validateModuleChildren(children?: ts.Node[])
{
    // Validate that the children array actually contains declaration elements.
    // This should never trigger, but is here for safety.
    if (children)
    {
        for (let i = children.length - 1; i >= 0; --i)
        {
            const child = children[i];
            if (!ts.isClassDeclaration(child)
                && !ts.isInterfaceDeclaration(child)
                && !ts.isFunctionDeclaration(child)
                && !ts.isEnumDeclaration(child)
                && !ts.isModuleDeclaration(child)
                && !ts.isTypeAliasDeclaration(child)
                && !ts.isVariableStatement(child))
            {
                warn('Encountered child that is not a supported declaration, this is likely due to invalid JSDoc.', child);
                children.splice(i, 1);
            }
        }
    }
}

function handleComment<T extends ts.Node>(doclet: IDocletBase, node: T): T
{
    if (doclet.comment && doclet.comment.length > 4)
    {
        let comment = doclet.comment;

        // remove '/*' and '*/'
        comment = comment.substring(2, doclet.comment.length - 2);

        // remove '          *' leading spaces
        comment = comment.replace(/[ \t]+\*/g, ' *');

        // remove trailing spacesgit dif
        comment = comment.trim() + '\n ';

        const kind = ts.SyntaxKind.MultiLineCommentTrivia;

        ts.addSyntheticLeadingComment(node, kind, comment, true);
    }

    return node;
}

export function createClass(doclet: IClassDoclet, children?: ts.Node[]): ts.ClassDeclaration
{
    validateClassChildren(children);

    const mods: ts.Modifier[] = [];
    const members = children as ts.ClassElement[] || [];
    const typeParams = resolveTypeParameters(doclet);
    const heritageClauses = resolveHeritageClauses(doclet, false);

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');
    if (!doclet.memberof)
        mods.push(declareModifier);
    if (doclet.virtual)
        mods.push(abstractModifier);

    if (doclet.params)
    {
        const params = createFunctionParams(doclet);

        members.unshift(
            ts.createConstructor(
                undefined,  // decorators
                undefined,  // modifiers
                params,     // parameters
                undefined   // body
            )
        );
    }

    if (doclet.properties)
    {
        const tree = new PropTree(doclet.properties);

        for (let i = 0; i < tree.roots.length; ++i)
        {
            const node = tree.roots[i];
            const opt = node.prop.optional ? ts.createToken(ts.SyntaxKind.QuestionToken) : undefined;
            const t = node.children.length ? createTypeLiteral(node.children) : resolveType(node.prop.type);

            const property = ts.createProperty(
                undefined,
                undefined,
                node.name,
                opt,
                t,
                undefined
            );

            if (node.prop.description)
            {
                let comment = `*\n * ${node.prop.description.split(/\r\s*/).join("\n * ")}\n`;
                ts.addSyntheticLeadingComment(property, ts.SyntaxKind.MultiLineCommentTrivia, comment, true)
            }

            members.push(property);
        }
    }

    return handleComment(doclet, ts.createClassDeclaration(
        undefined,      // decorators
        mods,           // modifiers
        doclet.name,    // name
        typeParams,     // typeParameters
        heritageClauses,// heritageClauses
        members         // members
    ));
}

export function createInterface(doclet: IClassDoclet, children?: ts.Node[]): ts.InterfaceDeclaration
{
    validateInterfaceChildren(children);

    const mods: ts.Modifier[] = [];
    const members = children as ts.TypeElement[];
    const typeParams = resolveTypeParameters(doclet);
    const heritageClauses = resolveHeritageClauses(doclet, true);

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');
    if (!doclet.memberof)
        mods.push(declareModifier);
    if (doclet.virtual)
        mods.push(abstractModifier);

    return handleComment(doclet, ts.createInterfaceDeclaration(
        undefined,      // decorators
        mods,           // modifiers
        doclet.name,    // name
        typeParams,     // typeParameters
        heritageClauses,// heritageClauses
        members         // members
    ));
}

export function createFunction(doclet: IFunctionDoclet): ts.FunctionDeclaration
{
    const mods = doclet.memberof ? undefined : [declareModifier];
    const params = createFunctionParams(doclet);
    const type = createFunctionReturnType(doclet);
    const typeParams = resolveTypeParameters(doclet);

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');

    return handleComment(doclet, ts.createFunctionDeclaration(
        undefined,      // decorators
        mods,           // modifiers
        undefined,      // asteriskToken
        doclet.name,    // name
        typeParams,     // typeParameters
        params,         // parameters
        type,           // type
        undefined       // body
    ));
}

export function createClassMethod(doclet: IFunctionDoclet): ts.MethodDeclaration
{
    const mods: ts.Modifier[] = [];
    const params = createFunctionParams(doclet);
    const type = createFunctionReturnType(doclet);
    const typeParams = resolveTypeParameters(doclet);

    if (!doclet.memberof)
        mods.push(declareModifier);

    if (doclet.access === 'private')
        mods.push(ts.createModifier(ts.SyntaxKind.PrivateKeyword));
    else if (doclet.access === 'protected')
        mods.push(ts.createModifier(ts.SyntaxKind.ProtectedKeyword));
    else if (doclet.access === 'public')
        mods.push(ts.createModifier(ts.SyntaxKind.PublicKeyword));

    if (doclet.scope === 'static')
        mods.push(ts.createModifier(ts.SyntaxKind.StaticKeyword));

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');

    if (doclet.virtual)
        mods.push(abstractModifier);

    return handleComment(doclet, ts.createMethod(
        undefined,      // decorators
        mods,           // modifiers
        undefined,      // asteriskToken
        doclet.name,    // name
        undefined,      // questionToken
        typeParams,     // typeParameters
        params,         // parameters
        type,           // type
        undefined       // body
    ));
}

export function createInterfaceMethod(doclet: IFunctionDoclet): ts.MethodSignature
{
    const mods: ts.Modifier[] = [];
    const params = createFunctionParams(doclet);
    const type = createFunctionReturnType(doclet);
    const typeParams = resolveTypeParameters(doclet);

    if (!doclet.memberof)
        mods.push(declareModifier);

    if (doclet.scope === 'static')
        mods.push(ts.createModifier(ts.SyntaxKind.StaticKeyword));

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');

    if (doclet.virtual)
        mods.push(abstractModifier);

    return handleComment(doclet, ts.createMethodSignature(
        typeParams,     // typeParameters
        params,         // parameters
        type,           // type
        doclet.name,    // name
        undefined       // questionToken
    ));
}

export function createEnum(doclet: IMemberDoclet): ts.EnumDeclaration
{
    const mods: ts.Modifier[] = [];
    const props: ts.EnumMember[] = [];

    if (!doclet.memberof)
        mods.push(declareModifier);

    if (doclet.kind === 'constant')
        mods.push(constModifier);

    if (doclet.properties && doclet.properties.length)
    {
        for (let i = 0; i < doclet.properties.length; ++i)
        {
            const p = doclet.properties[i];

            props.push(ts.createEnumMember(p.name, undefined));
        }
    }

    return handleComment(doclet, ts.createEnumDeclaration(
        undefined,
        mods,
        doclet.name,
        props,
    ));
}

export function createClassMember(doclet: IMemberDoclet): ts.PropertyDeclaration
{
    const type = resolveType(doclet.type, doclet);

    const mods: ts.Modifier[] = getAccessModifiers(doclet);

    if (doclet.scope === 'static')
        mods.push(ts.createModifier(ts.SyntaxKind.StaticKeyword));

    if (doclet.kind === 'constant' || doclet.readonly)
        mods.push(readonlyModifier);

    return handleComment(doclet, ts.createProperty(
        undefined,      // decorators
        mods,           // modifiers
        doclet.name,    // name
        undefined,      // questionToken
        type,           // type
        undefined       // initializer
    ));
}

function getAccessModifiers(doclet: IMemberDoclet | IClassDoclet)
{
    const mods: ts.Modifier[] = [];

    if (doclet.access === 'private' || doclet.access === 'package')
        mods.push(ts.createModifier(ts.SyntaxKind.PrivateKeyword));
    else if (doclet.access === 'protected')
        mods.push(ts.createModifier(ts.SyntaxKind.ProtectedKeyword));
    else if (doclet.access === 'public')
        mods.push(ts.createModifier(ts.SyntaxKind.PublicKeyword));

    return mods
}

export function createConstructor(doclet: IClassDoclet)
{
    const params = createFunctionParams(doclet);
    return handleComment(doclet, ts.createConstructor(
        undefined,  // decorators
        getAccessModifiers(doclet),  // modifiers
        params,     // parameters
        undefined   // body
    ))
}

export function createInterfaceMember(doclet: IMemberDoclet): ts.PropertySignature
{
    const mods: ts.Modifier[] = [];
    const type = resolveType(doclet.type, doclet);

    if (doclet.kind === 'constant')
        mods.push(readonlyModifier);

    if (doclet.scope === 'static')
        mods.push(ts.createModifier(ts.SyntaxKind.StaticKeyword));

    return handleComment(doclet, ts.createPropertySignature(
        mods,           // modifiers
        doclet.name,    // name
        undefined,      // questionToken
        type,           // type
        undefined       // initializer
    ));
}

export function createNamespaceMember(doclet: IMemberDoclet): ts.VariableStatement
{
    const mods = doclet.memberof ? undefined : [declareModifier];
    const type = resolveType(doclet.type, doclet);

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');

    return handleComment(doclet, ts.createVariableStatement(
        mods,
        [ts.createVariableDeclaration(
            doclet.name,    // name
            type,           // type
            undefined       // initializer
        )]
    ));
}

export function createModule(doclet: INamespaceDoclet, nested: boolean, children?: ts.Node[]): ts.ModuleDeclaration
{
    validateModuleChildren(children);

    const mods = doclet.memberof ? undefined : [declareModifier];
    let body: ts.ModuleBlock | undefined = undefined;
    let flags = ts.NodeFlags.None;

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');

    if (nested)
        flags |= ts.NodeFlags.NestedNamespace;

    if (children)
        body = ts.createModuleBlock(children as ts.Statement[]);

    const name = ts.createStringLiteral(doclet.name);

    return handleComment(doclet, ts.createModuleDeclaration(
        undefined,      // decorators
        mods,           // modifiers
        name,           // name
        body,           // body
        flags           // flags
    ));
}

export function createNamespace(doclet: INamespaceDoclet, nested: boolean, children?: ts.Node[]): ts.ModuleDeclaration
{
    validateModuleChildren(children);

    const mods = doclet.memberof ? undefined : [declareModifier];
    let body: ts.ModuleBlock | undefined = undefined;
    let flags = ts.NodeFlags.Namespace;

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');

    if (nested)
        flags |= ts.NodeFlags.NestedNamespace;

    if (children)
    {
        body = ts.createModuleBlock(children as ts.Statement[]);
    }

    const name = ts.createIdentifier(doclet.name);

    return handleComment(doclet, ts.createModuleDeclaration(
        undefined,      // decorators
        mods,           // modifiers
        name,           // name
        body,           // body
        flags           // flags
    ));
}

export function createTypedef(doclet: ITypedefDoclet, children?: ts.Node[]): ts.TypeAliasDeclaration
{
    const mods = doclet.memberof ? undefined : [declareModifier];
    const type = resolveType(doclet.type, doclet);
    const typeParams = resolveTypeParameters(doclet);

    if (doclet.name.startsWith('exports.'))
        doclet.name = doclet.name.replace('exports.', '');

    return handleComment(doclet, ts.createTypeAliasDeclaration(
        undefined,      // decorators
        mods,           // modifiers
        doclet.name,    // name
        typeParams,     // typeParameters
        type            // type
    ));
}
