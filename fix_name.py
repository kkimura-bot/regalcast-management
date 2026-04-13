#!/usr/bin/env python3
"""
Firestoreの「木錦風太」→「木綿風太」 全件書き換えスクリプト
"""

import json
import subprocess
import urllib.request
import urllib.error
import sys

PROJECT_ID = "regalcast-app"
OLD_NAME = "木錦風太"
NEW_NAME = "木綿風太"

def get_access_token():
    """firebase-toolsの設定ファイルからアクセストークンを取得"""
    import os
    config_path = os.path.expanduser("~/.config/configstore/firebase-tools.json")
    with open(config_path) as f:
        data = json.load(f)
    return data["tokens"]["access_token"]

def firestore_request(method, path, body=None, token=None):
    """Firestore REST APIリクエスト"""
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  HTTPError {e.code}: {e.read().decode()}")
        return None

def list_collections(token):
    """トップレベルのコレクション一覧を取得"""
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents:listCollectionIds"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    data = json.dumps({}).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            return result.get("collectionIds", [])
    except urllib.error.HTTPError as e:
        print(f"  HTTPError {e.code}: {e.read().decode()}")
        return []

def get_all_docs(collection_path, token):
    """コレクション内の全ドキュメントを取得（ページネーション対応）"""
    docs = []
    page_token = None
    while True:
        path = f"/{collection_path}"
        url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents{path}?pageSize=300"
        if page_token:
            url += f"&pageToken={page_token}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            print(f"  HTTPError {e.code} on {collection_path}")
            break

        batch = result.get("documents", [])
        docs.extend(batch)
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return docs

def extract_string_value(field_value):
    """Firestore値からstringを取り出す"""
    if "stringValue" in field_value:
        return field_value["stringValue"]
    return None

def contains_old_name(doc):
    """ドキュメントのフィールドに旧名前が含まれているか確認"""
    fields = doc.get("fields", {})
    hits = []
    for key, val in fields.items():
        sv = extract_string_value(val)
        if sv and OLD_NAME in sv:
            hits.append(key)
        # arrayValue内もチェック
        if "arrayValue" in val:
            for i, item in enumerate(val["arrayValue"].get("values", [])):
                sv2 = extract_string_value(item)
                if sv2 and OLD_NAME in sv2:
                    hits.append(f"{key}[{i}]")
        # mapValue内もチェック
        if "mapValue" in val:
            for mk, mv in val["mapValue"].get("fields", {}).items():
                sv3 = extract_string_value(mv)
                if sv3 and OLD_NAME in sv3:
                    hits.append(f"{key}.{mk}")
    return hits

def replace_in_fields(fields):
    """フィールド内の旧名前を新名前に置換（コピーを返す）"""
    new_fields = {}
    for key, val in fields.items():
        new_val = dict(val)
        if "stringValue" in val:
            new_val["stringValue"] = val["stringValue"].replace(OLD_NAME, NEW_NAME)
        elif "arrayValue" in val:
            new_items = []
            for item in val["arrayValue"].get("values", []):
                new_item = dict(item)
                if "stringValue" in item:
                    new_item["stringValue"] = item["stringValue"].replace(OLD_NAME, NEW_NAME)
                new_items.append(new_item)
            new_val = {"arrayValue": {"values": new_items}}
        elif "mapValue" in val:
            new_map_fields = {}
            for mk, mv in val["mapValue"].get("fields", {}).items():
                new_mv = dict(mv)
                if "stringValue" in mv:
                    new_mv["stringValue"] = mv["stringValue"].replace(OLD_NAME, NEW_NAME)
                new_map_fields[mk] = new_mv
            new_val = {"mapValue": {"fields": new_map_fields}}
        new_fields[key] = new_val
    return new_fields

def update_doc(doc_name, fields, token):
    """ドキュメントを更新"""
    # doc_name は "projects/.../documents/collection/docId" 形式
    # REST APIのPATCHで更新
    url = f"https://firestore.googleapis.com/v1/{doc_name}"

    # 更新するフィールドのマスクを作成
    field_mask = ",".join(fields.keys())
    url += f"?updateMask.fieldPaths=" + "&updateMask.fieldPaths=".join(fields.keys())

    body = {"fields": fields}
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="PATCH")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  HTTPError {e.code}: {e.read().decode()}")
        return None

def main():
    print(f"=== Firestore 名前修正スクリプト ===")
    print(f"対象: {OLD_NAME} → {NEW_NAME}")
    print(f"プロジェクト: {PROJECT_ID}")
    print()

    token = get_access_token()
    print(f"アクセストークン取得: OK")

    # コレクション一覧を取得
    print("\n[1] トップレベルコレクションを取得中...")
    collections = list_collections(token)
    if not collections:
        print("  コレクションが取得できませんでした")
        sys.exit(1)
    print(f"  取得したコレクション: {collections}")

    total_fixed = 0
    fixed_docs = []

    # 各コレクションを検索
    for col in collections:
        print(f"\n[2] コレクション '{col}' を検索中...")
        docs = get_all_docs(col, token)
        print(f"  ドキュメント数: {len(docs)}")

        for doc in docs:
            hit_fields = contains_old_name(doc)
            if hit_fields:
                doc_name = doc["name"]
                doc_id = doc_name.split("/")[-1]
                print(f"  ヒット: {doc_id} (フィールド: {hit_fields})")

                # 置換後のフィールドを作成
                new_fields = replace_in_fields(doc.get("fields", {}))

                # 更新実行
                result = update_doc(doc_name, new_fields, token)
                if result:
                    print(f"    -> 更新完了: {doc_id}")
                    total_fixed += 1
                    fixed_docs.append({"collection": col, "doc_id": doc_id, "fields": hit_fields})
                else:
                    print(f"    -> 更新失敗: {doc_id}")

    print(f"\n=== 修正結果 ===")
    print(f"修正件数: {total_fixed} 件")
    if fixed_docs:
        for d in fixed_docs:
            print(f"  - {d['collection']}/{d['doc_id']} (フィールド: {d['fields']})")

    # 検証: 新しい名前で確認
    print(f"\n[3] 検証: 修正後の確認...")
    verify_count = 0
    for col in collections:
        docs = get_all_docs(col, token)
        for doc in docs:
            fields = doc.get("fields", {})
            for key, val in fields.items():
                sv = extract_string_value(val)
                if sv and NEW_NAME in sv:
                    doc_id = doc["name"].split("/")[-1]
                    print(f"  確認OK: {col}/{doc_id} - {key}: {sv}")
                    verify_count += 1
                # arrayValue内もチェック
                if "arrayValue" in val:
                    for item in val["arrayValue"].get("values", []):
                        sv2 = extract_string_value(item)
                        if sv2 and NEW_NAME in sv2:
                            doc_id = doc["name"].split("/")[-1]
                            print(f"  確認OK: {col}/{doc_id} - {key}[]: {sv2}")
                            verify_count += 1

    # 旧名前がまだ残っていないか確認
    print(f"\n[4] 残存確認: 旧名前 '{OLD_NAME}' が残っていないか...")
    remaining = 0
    for col in collections:
        docs = get_all_docs(col, token)
        for doc in docs:
            hit_fields = contains_old_name(doc)
            if hit_fields:
                doc_id = doc["name"].split("/")[-1]
                print(f"  まだ残っている: {col}/{doc_id} - {hit_fields}")
                remaining += 1

    if remaining == 0:
        print(f"  問題なし。旧名前は完全に削除されました。")

    print(f"\n=== 完了 ===")
    print(f"修正件数: {total_fixed} 件")
    print(f"検証ヒット件数: {verify_count} 件")
    print(f"残存件数: {remaining} 件")

if __name__ == "__main__":
    main()
