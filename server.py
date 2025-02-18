from flask import Flask, jsonify, render_template, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_bootstrap import Bootstrap5
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Integer, String, Float
import csv
from flask_wtf import FlaskForm, CSRFProtect
from wtforms import StringField, SubmitField
from wtforms.validators import DataRequired, Length

app = Flask(__name__)
app.secret_key = "tO$&!|0wkamvVia0?n$NqIRVWOG69"
class Base(DeclarativeBase):
    pass

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///hotels.db"
db = SQLAlchemy(model_class=Base)
db.init_app(app)
Bootstrap5(app)
csrf = CSRFProtect(app)

class SearchForm(FlaskForm):
    name = StringField("Search for a charge station", validators=[DataRequired(), Length(1, 40)])
    submit = SubmitField("Submit")

class Hotel(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(250), nullable=False)
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
                    type=row["layer_name"], 
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


@app.route("/all")
def all_hotels():
    page = request.args.get("page", 1, type=int)
    hotel_type = request.args.get("type", None)
    
    hotel_types = db.session.query(Hotel.type).distinct().all()
    hotel_types = [ht[0] for ht in hotel_types]
    
    if hotel_type:
        hotels = Hotel.query.filter_by(type=hotel_type).paginate(page=page, per_page=10)
    else:
        hotels = Hotel.query.paginate(page=page, per_page=10)
    
    return render_template("all_hotels.html", hotels=hotels, hotel_types=hotel_types)

@app.route("/search", methods=['GET', 'POST'])
def search():
    form = SearchForm()
    message = ""
    if form.validate_on_submit():
        result = db.session.execute(db.select(Hotel).where(Hotel.name == form.name.data))
        hotel = result.scalar()
        if hotel:
            return redirect(url_for("hotel", hotel_id=hotel.id))
        else:
            message = "That search term is not in our database."
    return render_template("search.html", form=form, message=message)

@app.route("/hotel/<int:hotel_id>")
def hotel(hotel_id):
    hotel = db.session.get(Hotel, hotel_id)
    if hotel is None:
        return "Hotel not found", 404
    return render_template("hotel.html", hotel=hotel)


@app.route("/api/add", methods = ["POST"])
def new_hotel():
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

@app.route("/api/all")
def all_cafe():
    result = db.session.execute(db.select(Hotel).order_by(Hotel.name))
    all_hotels = result.scalars().all()
    return jsonify(chargers=[hotel.to_dict() for hotel in all_hotels])


if __name__ == "__main__":
  app.run(debug=True)
    # csv_to_db()