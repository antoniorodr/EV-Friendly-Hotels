from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from flask_bootstrap import Bootstrap5
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Integer, String, Float
import csv

app = Flask(__name__)
class Base(DeclarativeBase):
    pass

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///hotels.db"
db = SQLAlchemy(model_class=Base)
db.init_app(app)
Bootstrap5(app)

class Hotel(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(250), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    longitude: Mapped[str] = mapped_column(Float(20), nullable=False)
    latitude: Mapped[str] = mapped_column(Float(20), nullable=False)
    maps_link: Mapped[str] = mapped_column(String(250), nullable=False)

    def to_dict(self):
        return {column.name: getattr(self, column.name) for column in self.__table__.columns}

with app.app_context():
    db.create_all()

def csv_to_db():
    with open ("data/EV-friendly hotels in Europe.csv") as file:
        reader = csv.DictReader(file)
        for row in reader:
            with app.app_context():
                new_hotel = Hotel(
                    name=row["Name"],  
                    description=row["Description"],  
                    longitude=row["longitude"],  
                    latitude=row["latitude"],  
                    maps_link=row["Maps link"],  
                )

                db.session.add(new_hotel)
                db.session.commit()


@app.route("/")
def home():
  return render_template("index.html")


@app.route("/add", methods = ["POST"])
def new_cafe():
    name = request.form.get("name")
    existing_hotel = db.session.query(Hotel).filter_by(name=name).first()
    if existing_hotel:
        return jsonify(error={"message": "A hotel with this name already exists."}), 400

    new_hotel = Hotel(
        name=name,
        description=request.form.get("description"),
        longitude=request.form.get("longitude"),
        latitude=request.form.get("latitude"),
        maps_link=request.form.get("maps_link") == 'True',
    )

    db.session.add(new_hotel)
    db.session.commit()
    return jsonify(response={"success": "Successfully added the new hotel."})


if __name__ == "__main__":
  app.run(debug=True)