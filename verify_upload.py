import io
import os
import psycopg2

os.environ["SECRET_KEY"] = "78558b5db9ffdff87c73a10a3a6638cf2a484caed061f5cbdf0fa3975095927c"
os.environ["ADMIN_PASSWORD"] = "admin123"
os.environ["ADMIN_EMAIL"] = "campuscopilot1234@gmail.com"
os.environ["FLASK_DEBUG"] = "1"
os.environ["DATABASE_URL"] = "postgresql://postgres:54321@localhost:5432/campus_copilot"

import app as campus_app

campus_app.init_db()

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='complaints' ORDER BY ordinal_position")
print("COMPLAINT_COLUMNS", cur.fetchall())
cur.execute("SELECT id FROM students WHERE lower(college_email)=lower(%s)", ("upload.test@campus.edu",))
row = cur.fetchone()
if row is None:
    cur.execute(
        "INSERT INTO students (name, roll_number, college_email, password_hash, role, is_verified, is_active, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        ("Upload Tester", "UT-101", "upload.test@campus.edu", "hash", "student", True, True, campus_app.datetime.now()),
    )
    conn.commit()
    cur.execute("SELECT id FROM students WHERE lower(college_email)=lower(%s)", ("upload.test@campus.edu",))
    row = cur.fetchone()
student_id = row[0]
conn.close()

client = campus_app.app.test_client()
with client.session_transaction() as sess:
    sess["student_id"] = student_id
    sess["student_name"] = "Upload Tester"
    sess["roll_number"] = "UT-101"

img = b"\x89PNG\r\n\x1a\n" + b"\x00" * 10
resp = client.post(
    "/api/complaints",
    data={
        "description": "Broken light in corridor",
        "photo": (io.BytesIO(img), "sample.png", "image/png"),
    },
    content_type="multipart/form-data",
)
print("STATUS", resp.status_code)
print("JSON", resp.get_json())
print("UPLOAD_DIR_EXISTS", os.path.isdir(os.path.join(campus_app.app.static_folder, "uploads", "complaints")))
